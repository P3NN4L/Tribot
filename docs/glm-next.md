# 交给 GLM 做的三件事（MCP / 浏览器 / 桌面）

> 给 GLM 的用法：在 TriBot 里选「工程师」Bot、模型 GLM-5.3、打开「计划」，
> 先贴最下面的「总控提示词」，再一张一张贴任务卡。**一次只做一张**。
> GLM 没有视觉能力：所有验收都以文本、命令输出、测试结果为准，截图只是给人看的。

---

## 卡 1：MCP stdio 客户端（优先）

**目标**：让 TriBot 能连本机 MCP 服务器，列出工具并调用，把结果返回给 Bot。

**输入**：
- 工具定义参考 `packages/core/src/tools/index.ts` 里的 `ToolDef` 和 `ALL_TOOLS`
- 工具上下文 `ToolContext`（含 workspace、db、env）
- 配置放 `data/mcp.json`，允许环境变量 `TRIBOT_MCP_CONFIG` 覆盖路径
- 协议：JSON-RPC 2.0，stdio，**换行分隔**（每行一个 JSON）

**交付物**：
1. 新文件 `packages/core/src/tools/mcp.ts`，导出两个 `ToolDef`：
   - `mcp_list`：连上所有配置的 server，返回 `server / tool / description`
   - `mcp_call`：参数 `server`、`tool`、`arguments`（对象），返回工具结果文本
2. 配置格式：
   ```json
   { "servers": [
     { "name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\tmp"] }
   ] }
   ```
3. 连接流程：spawn → 发 `initialize`（protocolVersion `2024-11-05`）→ 等响应 →
   发 `notifications/initialized` → `tools/list` 或 `tools/call` → 关闭进程。
4. 超时 15 秒；stderr 收进错误信息；输出截断到 12000 字符。
5. 在 `ALL_TOOLS` 注册；工程师/管家/研究员/审稿人的 tools 加上这两个。
6. 测试：`packages/core/tests/fixtures/mcp-echo.mjs`（一个只实现 initialize / tools/list / tools/call 的假服务器），
   在 `packages/core/tests/mcp.test.ts` 里测 list 与 call。

**验收**：
- `pnpm --filter @tribot/core exec tsc --noEmit` 通过
- `pnpm --filter @tribot/core test` 全绿（新增用例至少 2 条）
- 手工：`data/mcp.json` 指向 `mcp-echo.mjs`，在对话里让 Bot 调 `mcp_list` 能看到 `echo` 工具

**禁区**：
- 不要改 server 路由、数据库、打包脚本
- 不要把 secret 写进 `data/mcp.json` 的仓库副本
- 不要一次拉起多个常驻进程；每次调用结束必须 kill

---

## 卡 2：浏览器工具（Playwright）

**目标**：给 Bot 一个能打开页面、取正文、点击元素、导出截图的工具，用于验证网页。

**输入**：
- 本机已装 Chrome；Node 24
- 可以引入 `playwright-core`（不要 `playwright` 全量下载浏览器）；用 `chromium.launch({ channel: 'chrome', headless: true })`
- 工具定义同样参考 `ToolDef`

**交付物**：
1. 新文件 `packages/core/src/tools/browser.ts`，导出 `browser` 工具：
   - `action: 'open' | 'text' | 'click' | 'screenshot'`
   - `url`（open 必填）、`selector`（click/text 可选）、`path`（screenshot 保存到工作区）
2. `text` 返回**可见文本**（`document.body.innerText` 截断）和页面标题；
   同时返回前 30 个可交互元素（`a,button,input` 的文本 + 选择器），让没有视觉的 Bot 也能决定点哪。
3. `open` 后保持页面直到下次调用；每次工具调用结束关闭浏览器（简单可靠优先，别做常驻池）。
4. 安全：只允许 `http/https`；不代填密码；不自动提交表单；截图只写工作区内。
5. 在 `ALL_TOOLS` 注册；工程师 tools 加上 `browser`。
6. 测试：用 `tests/fixtures/page.html` 本地文件起静态页（或 `data:` URL），测 open/text/click。

**验收**：
- typecheck / test 通过（新增至少 1 条用例）
- 手工：`browser open https://example.com` → `text` 返回标题 "Example Domain"
- 截图落在任务工作区，返回路径

**禁区**：
- 不要下载 Chromium 大包（必须用系统 Chrome）
- 不要绕过登录/验证码
- 不要把页面全文无脑塞进上下文（截断）

---

## 卡 3：桌面自动化（Windows）

**目标**：操作本机桌面窗口：列窗口、截图、点击、输入、按键。

**输入**：
- Windows；PowerShell 可用
- 用 `Add-Type` 调 user32（`EnumWindows`、`GetWindowText`、`GetWindowRect`、`SetCursorPos`、`mouse_event`、`keybd_event`）
- 权限体系：`ToolDef.risk = 'high'`，走现有审批

**交付物**：
1. 新文件 `packages/core/src/tools/desktop.ts`，导出 `desktop` 工具：
   - `action: 'list_windows' | 'screenshot' | 'click' | 'type' | 'key'`
   - `title`（窗口标题匹配）、`x/y`、`text`、`keys`
2. `list_windows` 返回标题 + 进程名；`screenshot` 用 PowerShell 截目标窗口到工作区 PNG。
3. 所有动作前校验目标窗口存在；找不到就报错，不要盲点。
4. 在 `ALL_TOOLS` 注册；工程师/管家 tools 加上 `desktop`。
5. 测试：手工用记事本验收（打开 → list_windows 找到 → type → screenshot），不要求自动化测试。

**验收**：
- typecheck 通过
- 记事本里 `type "hello"` 能出现在窗口里
- 截图能在工作区打开

**禁区**：
- 不点删除/支付/发送类按钮（工具层面不做语义判断，但技能里要写明）
- 不输入密码
- 不操作非目标窗口

---

## 总控提示词（先贴这个）

```
你是 TriBot 的工程师。仓库在 C:\Users\admin\Desktop\Tribot。
请读 docs/glm-next.md，按卡 1 → 卡 2 → 卡 3 的顺序做，一次只做一张。
每张开始前先给计划（改哪些文件、加什么依赖、怎么测），我批准后再动手。
完成后必须贴：改了哪些文件、验收命令的完整输出、还差什么。
不要改数据库、权限、打包相关代码；不要伪造测试结果。
```

## 卡住了怎么办

- 依赖装不上：先贴完整报错，不要换方案硬写
- 测试过不了：先贴失败用例和日志，不要删测试
- 需要我确认接口：停下来问，不要猜
