import { parseExpression } from 'cron-parser';
import type { Routine } from '@tribot/shared';
import { rowToRoutine, createSession } from '../db.js';
import type { Db } from '../db.js';
import { deepseekPeriod } from '../quota/clock.js';
import { runChat, type EngineContext } from '../engine/index.js';

// ===== Routine：定时任务（cron 五段，本地时区），后台静默执行 + 通知 =====

/** 低谷专属任务在高峰时段延后执行（不消耗 lastRun，下一个 tick 再判断） */
export function shouldDeferRoutine(routine: Pick<Routine, 'offpeakOnly'>, period: 'peak' | 'offpeak'): boolean {
  return !!routine.offpeakOnly && period === 'peak';
}

export function validateCron(expr: string): boolean {
  try {
    parseExpression(expr, { tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    return true;
  } catch {
    return false;
  }
}

function prevFireTime(expr: string, now: Date): Date | null {
  try {
    const iter = parseExpression(expr, {
      currentDate: now,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return iter.prev().toDate();
  } catch {
    return null;
  }
}

export interface SchedulerCallbacks {
  onRunStart?: (r: Routine) => void;
  onRunEnd?: (r: Routine, status: 'ok' | 'error', summary: string) => void;
}

export class RoutineScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private ctx: EngineContext,
    private cbs: SchedulerCallbacks = {},
  ) {}

  start(intervalMs = 30_000): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const routines = (this.ctx.db.prepare('SELECT * FROM routines WHERE enabled = 1').all() as any[]).map(rowToRoutine);
      for (const r of routines) {
        if (shouldDeferRoutine(r, deepseekPeriod())) continue;
        const prev = prevFireTime(r.schedule, new Date());
        if (!prev) continue;
        const lastRun = r.lastRunAt ? new Date(r.lastRunAt).getTime() : 0;
        if (prev.getTime() <= lastRun) continue;
        await this.runOnce(r.id);
      }
    } finally {
      this.running = false;
    }
  }

  /** 立即执行一次（手动触发 / 定时触发共用） */
  async runOnce(routineId: string): Promise<{ status: 'ok' | 'error'; summary: string }> {
    const db = this.ctx.db;
    const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId) as any;
    if (!row) return { status: 'error', summary: 'routine 不存在' };
    const r = rowToRoutine(row);

    db.prepare('UPDATE routines SET last_run_at = ?, last_status = ? WHERE id = ?').run(new Date().toISOString(), 'running', r.id);
    this.cbs.onRunStart?.(r);

    let status: 'ok' | 'error' = 'ok';
    let summary = '';
    try {
      const message = await runChat(this.ctx, {
        sessionId: r.sessionId,
        botId: r.botId,
        userText: r.prompt,
        emit: () => {}, // 后台静默：不推流，结果落会话 + 通知
      });
      summary = message.content.slice(0, 500);
      status = message.routeReason === '执行失败' || message.routeReason === '无可用模型' ? 'error' : 'ok';
    } catch (e: any) {
      status = 'error';
      summary = String(e?.message ?? e).slice(0, 500);
    }
    db.prepare('UPDATE routines SET last_status = ? WHERE id = ?').run(status, r.id);
    db.prepare('INSERT INTO routine_runs(routine_id, ts, status, summary) VALUES(?,?,?,?)').run(
      r.id, new Date().toISOString(), status, summary,
    );
    this.cbs.onRunEnd?.(r, status, summary);
    return { status, summary };
  }
}

export function createRoutineWithSession(
  db: Db,
  input: { name: string; schedule: string; botId: string; prompt: string; offpeakOnly?: boolean },
): Routine {
  const session = createSession(db, `⏰ ${input.name}`, 'chat');
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO routines(id, name, schedule, bot_id, prompt, session_id, enabled, offpeak_only) VALUES(?,?,?,?,?,?,1,?)',
  ).run(id, input.name, input.schedule, input.botId, input.prompt, session.id, input.offpeakOnly ? 1 : 0);
  return rowToRoutine(db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as any);
}

export function ensureRoutineSession(db: Db, routineId: string): void {
  const row = db.prepare('SELECT session_id FROM routines WHERE id = ?').get(routineId) as any;
  if (!row) return;
  const exists = db.prepare('SELECT id FROM sessions WHERE id = ?').get(row.session_id);
  if (!exists) {
    const s = createSession(db, '⏰ Routine', 'chat');
    db.prepare('UPDATE routines SET session_id = ? WHERE id = ?').run(s.id, routineId);
  }
}
