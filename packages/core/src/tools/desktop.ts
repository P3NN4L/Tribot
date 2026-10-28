import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolContext, ToolDef } from './index.js';
import { rootsOf, safeResolve } from './index.js';

// ===== Windows 桌面自动化（PowerShell + user32）=====
// 权限：risk = high，走现有审批（自动模式直接拒、询问模式逐次问）。
// 安全：所有动作先校验目标窗口存在并置前台，绝不盲点；不代填密码（描述里已声明，语义级禁止靠技能约束）。

const PS_TIMEOUT = 25_000;

const WIN32_CS = `
using System;using System.Runtime.InteropServices;using System.Text;
public class Win32{
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint vk, uint type);
  public struct RECT{public int Left,Top,Right,Bottom;}
}`;

/** SendKeys 特殊字符转义：把 + ^ % ~ ( ) { } [ ] 包进 {} */
function escapeSendKeys(s: string): string {
  return s.replace(/[\+\^\%~\(\)\{\}\[\]]/g, (c) => `{${c}}`);
}

function runPowerShell(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      timeout: PS_TIMEOUT,
    });
    let out = '';
    let errTxt = '';
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (errTxt += d.toString('utf8')));
    child.on('error', (e) => resolve({ code: -1, stdout: out, stderr: `启动失败：${e.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: out, stderr: errTxt }));
  });
}

const PS_HEAD = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\nAdd-Type -Language CSharp -TypeDefinition @'\n${WIN32_CS}\n'@;\n`;

/** 枚举可见顶层窗口：行格式 pid|进程名|标题|x,y,w,h|hwnd */
const LIST_SCRIPT = `${PS_HEAD}
$results = New-Object System.Collections.ArrayList
$cb = [Win32+EnumWindowsProc]{
  param($h, $l)
  if ([Win32]::IsWindowVisible($h)) {
    $len = [Win32]::GetWindowTextLength($h)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [void][Win32]::GetWindowText($h, $sb, $sb.Capacity)
      $title = $sb.ToString()
      if ($title.Trim().Length -gt 0) {
        $wpid = 0
        [void][Win32]::GetWindowThreadProcessId($h, [ref]$wpid)
        $r = New-Object Win32+RECT
        [void][Win32]::GetWindowRect($h, [ref]$r)
        $proc = ''
        try { $proc = (Get-Process -Id $wpid -ErrorAction Stop).ProcessName } catch {}
        [void]$results.Add("$wpid|$proc|$title|$($r.Left),$($r.Top),$($r.Right - $r.Left),$($r.Bottom - $r.Top)|$h")
      }
    }
  }
  return $true
}.GetNewClosure()
[void][Win32]::EnumWindows($cb, [IntPtr]::Zero)
$results | ForEach-Object { $_ }
`;

interface WinEntry {
  pid: number;
  proc: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hwnd: string;
}

async function listWindows(): Promise<WinEntry[]> {
  const r = await runPowerShell(LIST_SCRIPT);
  if (r.code !== 0) throw new Error(`枚举窗口失败：${r.stderr.slice(0, 400) || r.stdout.slice(0, 400)}`);
  const out: WinEntry[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || !t.includes('|')) continue;
    const [pid, proc, title, rect, hwnd] = t.split('|');
    const [x, y, w, h] = rect.split(',').map(Number);
    if (Number.isFinite(x)) out.push({ pid: Number(pid), proc, title, x, y, w, h, hwnd });
  }
  return out;
}

/** 目标解析：精确匹配优先，其次唯一子串匹配；找不到/歧义都报错并给候选 */
function resolveTarget(windows: WinEntry[], title: string): { entry: WinEntry } | { error: string } {
  const t = title.trim().toLowerCase();
  const exact = windows.filter((w) => w.title.toLowerCase() === t);
  if (exact.length >= 1) return { entry: exact[0] };
  const partial = windows.filter((w) => w.title.toLowerCase().includes(t));
  if (partial.length === 1) return { entry: partial[0] };
  if (partial.length === 0) {
    const sample = windows.slice(0, 15).map((w) => `  ${w.proc} | ${w.title.slice(0, 60)}`).join('\n');
    return { error: `没有找到标题含 "${title}" 的窗口。当前可见窗口（部分）：\n${sample}` };
  }
  const sample = partial.slice(0, 10).map((w) => `  ${w.proc} | ${w.title.slice(0, 60)}`).join('\n');
  return { error: `"${title}" 匹配到 ${partial.length} 个窗口，无法确定目标，请给更完整的标题：\n${sample}` };
}

/** 恢复最小化 + 置前台（否则坐标/按键会落在别的窗口上）。
 * Windows 前台锁：后台进程 SetForegroundWindow 会失败，用「先按一下 Alt」的经典办法解锁；
 * 成败以 GetForegroundWindow()==目标 为准（客观事实，不信返回值）。 */
const FOCUS_SCRIPT = (hwnd: string) => `${PS_HEAD}
$h = [IntPtr]${hwnd}
$ok = $false
if ([Win32]::GetForegroundWindow() -eq $h) {
  $ok = $true
} else {
  if ([Win32]::IsIconic($h)) { [void][Win32]::ShowWindow($h, 9) }
  Start-Sleep -Milliseconds 150
  [void][Win32]::SetForegroundWindow($h)
  [Win32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [Win32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][Win32]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 300
  if ([Win32]::GetForegroundWindow() -eq $h) { $ok = $true } else { $ok = $false }
}
if ($ok) { 'FOCUS_OK' } else { 'FOCUS_FAIL' }
`;

const CLICK_SCRIPT = (hwnd: string, x: number, y: number) => `${PS_HEAD}
$h = [IntPtr]${hwnd}
$r = New-Object Win32+RECT
[void][Win32]::GetWindowRect($h, [ref]$r)
$px = $r.Left + ${x}
$py = $r.Top + ${y}
[void][Win32]::SetCursorPos($px, $py)
Start-Sleep -Milliseconds 120
[Win32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
[Win32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
"CLICK $px,$py"
`;

const TYPE_SCRIPT = (hwnd: string, text: string) => `${PS_HEAD}
Add-Type -AssemblyName System.Windows.Forms
# 本机环境存在低级键盘钩子，会吞掉「注入的」空格（真实键盘不受影响）；
# 因此 type 走剪贴板 + Ctrl+V 粘贴通道（控制键组合不受该钩子影响），并备份/恢复剪贴板。
\$text = '${text.replace(/'/g, "''")}'
\$bk = \$null
try { \$bk = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch {}
try { Set-Clipboard -Value \$text -ErrorAction Stop } catch { throw '写入剪贴板失败：' + \$_.Exception.Message }
\$h = [IntPtr]${hwnd}
[void][Win32]::SetForegroundWindow(\$h)
Start-Sleep -Milliseconds 350
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 400
try { if (\$null -ne \$bk -and \$bk -ne '') { Set-Clipboard -Value \$bk } } catch {}
'TYPE_OK paste'
`;

const KEY_SCRIPT = (hwnd: string, keys: string) => `${PS_HEAD}
Add-Type -AssemblyName System.Windows.Forms
$h = [IntPtr]${hwnd}
[void][Win32]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')
'KEY_OK'
`;

const SHOT_SCRIPT = (hwnd: string, outPath: string) => `${PS_HEAD}
Add-Type -AssemblyName System.Drawing
$h = [IntPtr]${hwnd}
$r = New-Object Win32+RECT
[void][Win32]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if ($w -le 0 -or $ht -le 0) { throw 'window rect invalid' }
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save('${outPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"SHOT $w x $ht"
`;

function fail(output: string): { ok: boolean; output: string } {
  return { ok: false, output };
}
function ok(output: string): { ok: boolean; output: string } {
  return { ok: true, output };
}

export const desktop: ToolDef = {
  name: 'desktop',
  description:
    '操作本机 Windows 桌面窗口（高危，每次都要用户审批）。action：list_windows（列可见窗口：进程/标题/位置）/ click（在目标窗口内相对坐标 x,y 点击）/ type（向目标窗口输入文本，禁止输入密码验证码）/ key（SendKeys 按键，如 {ENTER}、^c）/ screenshot（目标窗口截图存工作区）。除 list_windows 外都要 title 参数定位窗口；坐标以窗口左上角为原点。',
  risk: 'high',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list_windows', 'screenshot', 'click', 'type', 'key'] },
      title: { type: 'string', description: '目标窗口标题（精确或唯一子串），除 list_windows 外必填' },
      x: { type: 'number', description: 'click：相对窗口左上角的横向像素' },
      y: { type: 'number', description: 'click：相对窗口左上角的纵向像素' },
      text: { type: 'string', description: 'type：要输入的文本' },
      keys: { type: 'string', description: 'key：SendKeys 记法，如 {ENTER}、{TAB}、^c、%f' },
      path: { type: 'string', description: 'screenshot：工作区内相对路径，如 "win.png"' },
    },
    required: ['action'],
  },
  async run(args, ctx: ToolContext) {
    if (process.platform !== 'win32') return fail('desktop 工具仅支持 Windows');
    if (ctx.planMode) return fail('计划模式：先提交计划，用户批准后再操作桌面');
    const action = String(args.action ?? '');
    if (action !== 'list_windows' && !String(args.title ?? '').trim()) {
      return fail(`action "${action}" 需要 title 参数定位目标窗口`);
    }

    const decision = await ctx.approvals.request({
      sessionId: ctx.sessionId,
      botName: ctx.bot.name,
      tool: 'desktop',
      args: { action, title: args.title, x: args.x, y: args.y, text: args.text, keys: args.keys, path: args.path },
      risk: 'high',
      reason: `桌面操作 ${action}${args.title ? `：窗口 "${String(args.title).slice(0, 40)}"` : ''}`,
    });
    if (decision !== 'approved') return fail(`审批未通过（${decision === 'denied' ? '已拒绝' : '超时'}）`);

    try {
      const windows = await listWindows();

      if (action === 'list_windows') {
        if (windows.length === 0) return ok('（当前没有可见窗口）');
        return ok(
          windows
            .map((w) => `${w.proc} | ${w.title.slice(0, 70)} | 位置(${w.x},${w.y}) 大小(${w.w}x${w.h})`)
            .join('\n'),
        );
      }

      const target = resolveTarget(windows, String(args.title));
      if ('error' in target) return fail(target.error);
      const { entry } = target;
      const rectNote = `目标：${entry.proc} | ${entry.title.slice(0, 60)} | (${entry.x},${entry.y}) ${entry.w}x${entry.h}`;

      // 前置：恢复并置前台，保证动作落在目标窗口
      const focus = await runPowerShell(FOCUS_SCRIPT(entry.hwnd));
      if (!focus.stdout.includes('FOCUS_OK')) {
        return fail(`${rectNote}\n无法把窗口置前台（${focus.stderr.slice(0, 200) || focus.stdout.slice(0, 200)}）`);
      }

      if (action === 'click') {
        const x = Math.floor(Number(args.x));
        const y = Math.floor(Number(args.y));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return fail('click 需要数值 x/y');
        if (x < 0 || y < 0 || x >= entry.w || y >= entry.h) {
          return fail(`${rectNote}\n坐标 (${x},${y}) 超出窗口范围 0..${entry.w - 1} x 0..${entry.h - 1}，拒绝越界点击`);
        }
        const r = await runPowerShell(CLICK_SCRIPT(entry.hwnd, x, y));
        return r.code === 0 && r.stdout.includes('CLICK')
          ? ok(`${rectNote}\n已点击窗口内相对坐标 (${x},${y})`)
          : fail(`${rectNote}\n点击失败：${(r.stderr || r.stdout).slice(0, 300)}`);
      }

      if (action === 'type') {
        const text = String(args.text ?? '');
        if (!text) return fail('type 需要 text 参数');
        const r = await runPowerShell(TYPE_SCRIPT(entry.hwnd, escapeSendKeys(text)));
        return r.code === 0 && r.stdout.includes('TYPE_OK')
          ? ok(`${rectNote}\n已输入 ${text.length} 个字符`)
          : fail(`${rectNote}\n输入失败：${(r.stderr || r.stdout).slice(0, 300)}`);
      }

      if (action === 'key') {
        const keys = String(args.keys ?? '');
        if (!keys) return fail('key 需要 keys 参数');
        const r = await runPowerShell(KEY_SCRIPT(entry.hwnd, keys));
        return r.code === 0 && r.stdout.includes('KEY_OK')
          ? ok(`${rectNote}\n已发送按键：${keys}`)
          : fail(`${rectNote}\n按键失败：${(r.stderr || r.stdout).slice(0, 300)}`);
      }

      if (action === 'screenshot') {
        const rel = String(args.path ?? '');
        if (!rel) return fail('screenshot 需要 path 参数（工作区内相对路径）');
        const abs = safeResolve(rootsOf(ctx), rel);
        if (!abs) return fail('路径越界：截图只能保存到工作区内');
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const r = await runPowerShell(SHOT_SCRIPT(entry.hwnd, abs));
        if (r.code === 0 && r.stdout.includes('SHOT')) {
          const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
          return ok(`${rectNote}\n截图已保存：${rel}（${(size / 1024).toFixed(1)} KB）`);
        }
        return fail(`${rectNote}\n截图失败：${(r.stderr || r.stdout).slice(0, 300)}`);
      }

      return fail(`未知 action：${action}`);
    } catch (e: any) {
      return fail(`桌面操作失败：${e?.message ?? e}`);
    }
  },
};
