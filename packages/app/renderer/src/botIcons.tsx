import type { ReactNode } from 'react';

// 5 个内置角色的线性图标（stroke 风格，跟随 currentColor）
const PATHS: Record<string, ReactNode> = {
  dispatcher: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z" />
    </>
  ),
  researcher: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="M15.4 15.4L20 20" />
    </>
  ),
  engineer: (
    <>
      <path d="M14.7 6.4a3.7 3.7 0 0 0-5 4.4l-4.6 4.6 2.7 2.7 4.6-4.6a3.7 3.7 0 0 0 4.4-5l-2.2 2.2-2.1-2.1z" />
    </>
  ),
  steward: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.2V12l3.1 2" />
    </>
  ),
  reviewer: (
    <>
      <path d="M12 3.4l6.8 2.8v4.7c0 4.2-2.8 7.1-6.8 8.7-4-1.6-6.8-4.5-6.8-8.7V6.2z" />
      <path d="M9.2 12l2 2 3.8-3.9" />
    </>
  ),
  default: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
};

const NAME_KEY: Record<string, string> = {
  总管: 'dispatcher', 研究员: 'researcher', 工程师: 'engineer', 管家: 'steward', 审稿人: 'reviewer',
};

export function BotIcon({ role, name, size = 16 }: { role?: string; name?: string; size?: number }) {
  let key: string | undefined = name ? NAME_KEY[name] : undefined;
  if (!key && role && PATHS[role]) key = role;
  if (!key && role) {
    if (role.includes('拆解') || role.includes('分派')) key = 'dispatcher';
    else if (role.includes('调研') || role.includes('证据')) key = 'researcher';
    else if (role.includes('工程')) key = 'engineer';
    else if (role.includes('巡检') || role.includes('值班')) key = 'steward';
    else if (role.includes('审查') || role.includes('对抗')) key = 'reviewer';
  }
  const body = (key && PATHS[key]) || PATHS.default;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  );
}
