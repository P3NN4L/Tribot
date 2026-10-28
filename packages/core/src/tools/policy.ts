import type { AppSettings, RiskLevel, SandboxMode, ToolGrant } from '@tribot/shared';
import { uid } from '../config.js';

// ===== 权限策略：沙箱分级 + 工具授权（一次 / 本会话 / 永久）=====

export const SANDBOX_LABEL: Record<SandboxMode, string> = {
  read_only: '只读',
  workspace: '工作区',
  full: '全权',
};

/** 只读类工具：任何沙箱都放行 */
const READ_TOOLS = new Set(['list_dir', 'read_file', 'list_skills', 'use_skill', 'web_search']);
/** 写文件类：工作区及以上放行（路径本身已被锁在 bot 工作区内） */
const WRITE_TOOLS = new Set(['write_file']);
/** 执行 / 外网类：高危，默认要问 */
const ACT_TOOLS = new Set(['run_command', 'http_fetch']);

/** 沙箱是否直接允许（不弹审批） */
export function sandboxAllows(sandbox: SandboxMode, tool: string, risk: RiskLevel): boolean {
  if (READ_TOOLS.has(tool)) return true;
  if (sandbox === 'read_only') return false;
  if (WRITE_TOOLS.has(tool)) return risk === 'low';
  if (sandbox === 'workspace') return false; // 命令/外网仍然逐次问
  // full：中危及以下自动放行，高危（白名单外命令、管道、eval）仍要问
  void ACT_TOOLS;
  return risk !== 'high';
}

/** 沙箱是否直接拒绝，返回拒绝原因 */
export function sandboxBlocks(sandbox: SandboxMode, tool: string): string | null {
  if (sandbox !== 'read_only') return null;
  if (READ_TOOLS.has(tool)) return null;
  return `沙箱为「只读」，${tool} 被拦下。到 设置 → 权限 调到「工作区」再试。`;
}

/** 找到覆盖该工具 + 会话的授权 */
export function grantMatches(grants: ToolGrant[] | undefined, tool: string, sessionId: string): ToolGrant | undefined {
  return (grants ?? []).find(
    (g) => g.tool === tool && (g.scope === 'always' || g.sessionId === sessionId),
  );
}

/** 追加一条授权（幂等：同工具同会话不重复） */
export function withGrant(
  settings: AppSettings,
  input: { tool: string; scope: 'session' | 'always'; sessionId?: string },
): AppSettings {
  const grants = settings.grants ?? [];
  const dup = grants.find(
    (g) => g.tool === input.tool && g.scope === input.scope
      && (input.scope === 'always' || g.sessionId === input.sessionId),
  );
  if (dup) return settings;
  const grant: ToolGrant = {
    id: uid(),
    tool: input.tool,
    scope: input.scope,
    sessionId: input.scope === 'session' ? input.sessionId : undefined,
    createdAt: new Date().toISOString(),
  };
  return { ...settings, grants: [...grants, grant] };
}

export function withoutGrant(settings: AppSettings, id: string): AppSettings {
  return { ...settings, grants: (settings.grants ?? []).filter((g) => g.id !== id) };
}

/** 清理某个会话删除后的会话级授权 */
export function dropSessionGrants(settings: AppSettings, sessionId: string): AppSettings {
  return { ...settings, grants: (settings.grants ?? []).filter((g) => g.sessionId !== sessionId) };
}
