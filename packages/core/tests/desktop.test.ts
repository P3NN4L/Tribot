import { describe, expect, it } from 'vitest';
import { desktop } from '../src/tools/desktop.js';
import type { ToolContext } from '../src/tools/index.js';

// ===== desktop 工具：纯校验路径（不碰真实窗口、不拉起 PowerShell 子进程）=====
// 只覆盖 run() 里位于审批之前的参数校验：
// 1) 除 list_windows 外的 action 必须带 title；2) 计划模式硬拦截。

const stubCtx = (planMode?: boolean): ToolContext =>
  ({ planMode }) as unknown as ToolContext;

describe.skipIf(process.platform !== 'win32')('desktop 工具（参数校验，无真实桌面操作）', () => {
  it('除 list_windows 外的 action：缺 title 参数被拒绝', async () => {
    const r = await desktop.run({ action: 'type', text: 'hello' }, stubCtx());
    expect(r.ok).toBe(false);
    expect(r.output).toContain('需要 title 参数');
  });

  it('计划模式：拒绝任何桌面窗口操作', async () => {
    const r = await desktop.run({ action: 'type', title: 'Notepad', text: 'hello' }, stubCtx(true));
    expect(r.ok).toBe(false);
    expect(r.output).toContain('计划模式');
  });
});
