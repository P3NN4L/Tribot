import { describe, expect, it } from 'vitest';
import { shouldDeferRoutine, validateCron } from '../src/routines/scheduler.js';

describe('Routine 低谷调度', () => {
  it('低谷专属任务在高峰延后，低谷执行', () => {
    expect(shouldDeferRoutine({ offpeakOnly: true }, 'peak')).toBe(true);
    expect(shouldDeferRoutine({ offpeakOnly: true }, 'offpeak')).toBe(false);
  });

  it('普通任务不受时段影响', () => {
    expect(shouldDeferRoutine({ offpeakOnly: false }, 'peak')).toBe(false);
    expect(shouldDeferRoutine({}, 'peak')).toBe(false);
  });

  it('cron 校验', () => {
    expect(validateCron('0 9 * * 1-5')).toBe(true);
    expect(validateCron('不是 cron')).toBe(false);
  });
});
