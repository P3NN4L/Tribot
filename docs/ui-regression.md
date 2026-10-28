# UI 回归验收清单（DOM / 文本级）

> 适用：`packages/app/renderer`（React + 手写 CSS，无测试 ID 体系）。
> 方法：`pnpm dev:web` 起前端（或 `pnpm dev` 起 Electron），按下列步骤逐项操作 + 断言。
> 选择器来源：`App.tsx` / `panels.tsx`（2026-10 快照），改动 DOM 前先同步本文档。

---

## 1. 工作区筛选（会话列表按工作区过滤）

**DOM 锚点**：顶栏 `.ws-wrap` > button `.ws-switcher` > span `.ws-name`；下拉 `.ws-menu`；会话项 `.ws-tag`。

1. 启动后顶栏可见 `.ws-switcher`，`.ws-name` 文本为 **「全体空间」**（无激活工作区时的默认值）。
2. 点击 `.ws-switcher` → `.ws-menu` 展开，含「设为工作目录…」与「全体空间」项。
3. 选一个工作目录后：`.ws-name` 变为该目录短名；左侧会话列表仅显示 `.ws-tag` 匹配该目录的会话。
4. 切回「全体空间」→ 会话列表恢复全量。

**失败样例**：选了工作目录但会话列表没变化 → 检查 `App.tsx` 中 `activeWorkspacePath` 过滤逻辑。

## 2. 队列（会话生成中继续发消息 → 排队）

**DOM 锚点**：输入区上方 `.queue-bar` > `.queue-label`，文本格式 **「排队 N」**（N ≥ 1 才渲染，无队列时整个 `.queue-bar` 不存在）。

1. 在一个会话发起一次生成（等待 `.typing` 出现，见 §4）。
2. 生成未结束时再输入一条消息发送 → 出现 `.queue-bar`，`.queue-label` 文本为「排队 1」。
3. 当前回复 done 后：队列首条自动发出，`.queue-label` 变「排队 0」或整个 bar 消失。
4. 期间点「停止」（§3）→ 队列被保留，不丢失（`App.tsx:1645` 按钮标题明确此行为）。

## 3. 停止（中断当前生成）

**DOM 锚点**：输入区 `button.send.stop`，可见文本 **「停止」**，title 含「排队中的消息会被保留」。

1. 会话空闲时：`.send.stop` 不存在（或不可见），只有发送按钮。
2. 生成中：`.send.stop` 出现；点击后 ≤ 2s 内：
   - SSE 流收到 `done` 事件（已生成的部分内容保留在消息里）；
   - `.typing` 消失，`.send.stop` 消失；
   - 若队列非空，下一条排队消息自动开始生成。
3. 后端断言：`POST /api/sessions/:id/stop` 空闲返回 `{ok:false}`，生成中返回 `{ok:true}`（已有单测 `packages/server/tests/stop.test.ts`）。

## 4. 行内思考（reasoning 流式展示）

**DOM 锚点**：占位 `.typing`，文本 **「思考中…」**（`App.tsx:2041`，`hasContent` 为 false 时显示）；思考内容按 `channel === 'reasoning'` 的 segments 顺序渲染。

1. 选「思考」档位（输入区 `label=思考`，title 含「快速/标准/深度」），向支持 reasoning 的模型（如 glm-5.3 deep）发消息。
2. 生成初期无正文 token 时：可见 `.typing`「思考中…」。
3. reasoning segments 先于 answer segments 渲染（同一段流里 `channel:'reasoning'` 在前）。
4. 切到 `fast` 档或走不支持 thinking 的模型：无 reasoning 段，`.typing` 只在纯等待时短暂出现。

## 5. 成员栏定位（会话成员侧栏）

**DOM 锚点**：`aside.bot-rail[aria-label="会话成员"]` > `.rail-label` 文本 **「成员」**。

1. 打开会话：`aside.bot-rail` 存在且 `aria-label` 为「会话成员」。
2. `.rail-label` 显示「成员」，下方为该会话 Bot 徽标（`botIcons.tsx` 提供图标）。
3. 屏幕宽度收窄：`bot-rail` 不遮挡消息区（响应式不塌陷）。
4. 新建会话默认第一个 Bot 入列；切换会话成员栏随会话切换。

---

## 快速回归顺序建议

全体空间 → 设工作目录（§1）→ 发消息 + 排队一条（§2）→ 生成中点停止（§3）→ deep 档看思考段（§4）→ 核对成员栏（§5）。
全部通过 = UI 回归绿。任一选择器失效（className 改名/文案改动）→ 先改本文档再改代码。
