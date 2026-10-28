import type { AppSettings, Approval, ApprovalScope, RiskLevel, StreamEvent } from '@tribot/shared';
import type { Db } from '../db.js';
import { nowIso, uid } from '../config.js';
import { SANDBOX_LABEL, grantMatches, sandboxAllows, sandboxBlocks, withGrant } from './policy.js';

// ===== 审批门 =====
// 优先级：沙箱拒绝 > 已有授权 > 沙箱放行 > 审批模式（ask_first / auto）> 问用户
// 用户批准时可选择作用域：仅本次 / 本会话 / 永久（后两者写入 settings.grants）。

export type Decision = 'approved' | 'denied' | 'timeout';

export interface ApprovalDeps {
  getSettings: () => AppSettings;
  saveSettings?: (settings: AppSettings) => void;
}

/** 全局审批路由表：server 的 HTTP 决定 → 正在等待的 chat 运行 */
const approvalHub: Map<string, (d: Decision, scope?: ApprovalScope) => void> =
  ((globalThis as any).__tribotApprovalHub ??= new Map());

/** 从外部（HTTP/API）决定一个挂起的审批。返回是否有等待者。 */
export function resolveApproval(id: string, decision: 'approved' | 'denied', scope: ApprovalScope = 'once'): boolean {
  const fn = approvalHub.get(id);
  if (!fn) return false;
  approvalHub.delete(id);
  fn(decision, scope);
  return true;
}

interface PendingEntry {
  resolve: (d: Decision, scope?: ApprovalScope) => void;
  timer: NodeJS.Timeout;
}

export class ApprovalService {
  private pending = new Map<string, PendingEntry>();

  constructor(
    private db: Db,
    private deps: ApprovalDeps,
    private emit: (e: StreamEvent) => void,
    private timeoutMs = 10 * 60_000,
  ) {}

  /** 返回 approved / denied / timeout */
  async request(input: {
    sessionId: string;
    botName: string;
    tool: string;
    args: Record<string, unknown>;
    risk: RiskLevel;
    reason: string;
  }): Promise<Decision> {
    const settings = this.deps.getSettings();
    const blocked = sandboxBlocks(settings.sandbox, input.tool);
    const grant = grantMatches(settings.grants, input.tool, input.sessionId);
    const sandboxPass = !blocked && sandboxAllows(settings.sandbox, input.tool, input.risk);

    let decision: Decision | null = null;
    let note = '';
    if (blocked) {
      decision = 'denied';
      note = blocked;
    } else if (grant) {
      decision = 'approved';
      note = `已有${grant.scope === 'always' ? '永久' : '本会话'}授权`;
    } else if (sandboxPass) {
      decision = 'approved';
      note = `沙箱「${SANDBOX_LABEL[settings.sandbox]}」放行`;
    } else if (settings.approval === 'auto') {
      decision = input.risk === 'high' ? 'denied' : 'approved';
      note = input.risk === 'high' ? '自动模式：高危直接拒绝' : '自动模式放行';
    }

    const id = uid();
    this.db.prepare(
      'INSERT INTO approvals(id, session_id, bot_name, tool, args, risk, reason, status, created_at, decided_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id, input.sessionId, input.botName, input.tool, JSON.stringify(input.args), input.risk,
      blocked ? `${input.reason}（${blocked}）` : input.reason,
      decision ?? 'pending', nowIso(), decision ? nowIso() : null,
    );

    if (decision) {
      if (note) this.emit({ type: 'tool_result', callId: `policy_${id}`, ok: decision === 'approved', preview: `权限：${note}` });
      return decision;
    }

    const approval: Approval = { ...input, id, status: 'pending', createdAt: nowIso() };
    this.emit({ type: 'approval_request', approval });

    return new Promise<Decision>((resolve) => {
      const settle = (d: Decision, scope?: ApprovalScope) => {
        approvalHub.delete(id);
        clearTimeout(timer);
        this.pending.delete(id);
        try { this.mark(id, d); } catch { /* 库已关闭 */ }
        if (d === 'approved' && scope && scope !== 'once') {
          this.grant(input.tool, scope, input.sessionId);
        }
        resolve(d);
      };
      const timer = setTimeout(() => {
        approvalHub.delete(id);
        this.pending.delete(id);
        try { this.mark(id, 'timeout'); } catch { /* 库已关闭 */ }
        resolve('timeout');
      }, this.timeoutMs);
      approvalHub.set(id, settle);
      this.pending.set(id, { resolve: settle, timer });
    });
  }

  /** 写入授权（本会话 / 永久）并落库 */
  grant(tool: string, scope: 'session' | 'always', sessionId: string): void {
    try {
      const next = withGrant(this.deps.getSettings(), { tool, scope, sessionId });
      this.deps.saveSettings?.(next);
    } catch {
      // 授权写入失败不影响本次放行
    }
  }

  decide(id: string, decision: 'approved' | 'denied', scope: ApprovalScope = 'once'): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve(decision, scope);
    return true;
  }

  private mark(id: string, status: Approval['status']) {
    this.db.prepare('UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?').run(status, nowIso(), id);
  }

  listPending(): Approval[] {
    const rows = this.db
      .prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50")
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      botName: r.bot_name,
      tool: r.tool,
      args: JSON.parse(r.args),
      risk: r.risk,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    }));
  }
}
