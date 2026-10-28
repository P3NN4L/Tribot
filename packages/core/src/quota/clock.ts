// ===== DeepSeek 峰谷时钟（官方规则：北京时间工作日 9:00-12:00 / 14:00-18:00 高峰，夜间及周末低谷半价）=====

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 上海时区的 星期(0=周日) 与 当日分钟数 */
export function shanghaiClock(now: Date = new Date()): { weekday: number; minutes: number } {
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAY_MAP[get('weekday')] ?? 1;
  const hour = parseInt(get('hour'), 10) % 24; // 某些环境输出 "24"
  const minute = parseInt(get('minute'), 10);
  return { weekday, minutes: hour * 60 + minute };
}

/** 高峰时段：周一~周五 的 9:00–12:00 与 14:00–18:00 */
export function deepseekPeriod(now: Date = new Date()): 'peak' | 'offpeak' {
  const { weekday, minutes } = shanghaiClock(now);
  if (weekday === 0 || weekday === 6) return 'offpeak';
  const inMorning = minutes >= 9 * 60 && minutes < 12 * 60;
  const inAfternoon = minutes >= 14 * 60 && minutes < 18 * 60;
  return inMorning || inAfternoon ? 'peak' : 'offpeak';
}

/** 上海时区本周一 00:00 对应的 ISO 时间（周计量起点） */
export function weekStartShanghai(now: Date = new Date()): string {
  const { weekday } = shanghaiClock(now);
  // 今天是周几就往前退几天到周一（周日=0 需要退 6 天）
  const back = weekday === 0 ? 6 : weekday - 1;
  const guess = new Date(now.getTime() - back * 24 * 3600_000);
  // 用格式化出的日期字符串构造当天 00:00（近似，误差在小时级以内，用于聚合展示足够）
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(guess);
  return `${ymd}T00:00:00+08:00`;
}

/** 当前 5 小时窗口起点（本地自计量的近似分桶） */
export function window5hStart(now: Date = new Date()): Date {
  const bucket = Math.floor(now.getTime() / (5 * 3600_000)) * 5 * 3600_000;
  return new Date(bucket);
}
