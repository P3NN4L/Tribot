# TriBot UI 重构方案（推倒重来版）

> 结论：不做第五次局部修补。保留后端与 API，**前端整体换成新的三栏工作台**。
> 旧 UI 不删除，先以 `?ui=v2` 并行存在，功能对齐后一次性切换，再删旧代码。

---

## 一、源码盘点（TriBot 前端）

| 文件 | 行数 | 现状 |
|---|---:|---|
| `App.tsx` | 2,113 | 所有页面、聊天、弹窗、状态都在这一个组件里 |
| `panels.tsx` | 1,321 | Bots / Skills / Plugins / Routines / Settings 挤在一个文件 |
| `styles.css` | 2,031 | 单文件样式，70+ 个区块，硬编码色值/间距多 |
| `api.ts` | 234 | HTTP/SSE 客户端，稳定，可复用 |
| `botIcons.tsx` | 68 | Bot 图标，可复用 |

页面/状态清单：

- 视图：`chat / bots / skills / plugins / routines / settings`
- 聊天：空状态、消息流、流式气泡、计划卡、审批卡、队列、任务卡、对比模式
- 浮层：命令面板、文件夹选择、删除确认、新建 Bot、模型选择、工作区菜单、Bot 下拉、上下文抽屉、右侧清单
- 设置：通用 / 模型与凭证 / 权限与工具 / 用量统计 / 关于
- 特殊状态：未连接 server、首次引导、桌面无边框窗口控制、原生壳（无 `window.tribot`）

### 现有问题（不是审美问题，是结构问题）

1. **顶栏过载**：会话标题 + 工作区 + 5 个 token 指标 + Bot 值守 + 清单 + 主题 + 沙箱 + 上下文 + 窗口控制，13 个元素抢一条 48px。
2. **右侧三套浮层**：上下文抽屉、清单 dock、审批卡各自 fixed/absolute，互相遮挡，宽度不统一。
3. **侧栏四段**：品牌、新会话、工作区、会话、额度、导航；信息密度高但没有层级，额度区块占掉会话列表高度。
4. **状态散落**：`App.tsx` 约 40 个 `useState`，消息/流/队列/清单/检查点/审批/弹窗全在一个组件；已有“多副本状态”的苗头。
5. **样式不可组合**：没有 Button/Field/Card/Tabs 等 primitives，靠 70 个 class 拼；改一处布局容易碰坏另一处。
6. **桌面与原生壳不一致**：Electron 有内联窗口控制，原生壳用系统标题栏；旧 UI 把窗口控制混进业务顶栏。

---

## 二、新设计方向

**关键词：Instrument panel（仪表台），不是聊天软件。**

- 深色为默认：石墨黑底、暖白文字、黄铜强调；浅色为“暖纸”主题。
- 密度高但呼吸感明确：8px 网格，1px hairline，不使用大面积渐变。
- 信息分层：**会话/工作区在左，对话在中，状态在右**；顶栏只保留标题和运行状态。
- 所有“工具性信息”（token、上下文、清单、改动、审批）进右侧 Workbench，不再挤顶栏。
- 动效只用于状态变化（120–180ms），不做装饰动画。

### 布局

```
┌──────────────┬───────────────────────────────────┬──────────────────┐
│ Sidebar 280  │ Chat                              │ Workbench 320    │
│              │                                   │                  │
│ TriBot       │ 会话标题        ● 运行中   ⋯      │ 状态 / 用量 / 上下文│
│ + 新会话      │ 工作区 · 模型 · 模式               │ ─────────────    │
│              │                                   │ 清单 3/7         │
│ 工作区 ▾      │ 消息流                            │ 本轮改动 2       │
│              │                                   │ 待审批 1         │
│ 今天          │                                   │ 用量 14k         │
│  会话…        │                                   │                  │
│ 昨天          │                                   │                  │
│  会话…        │                                   │                  │
│              │                                   │                  │
│ 额度（折叠）  │ 队列 / 计划卡                     │                  │
│              │ ┌───────────────────────────────┐ │                  │
│ Bot/技能/设置 │ │ 输入框                        │ │                  │
│              │ │ Bot 模型 思考 计划  发送      │ │                  │
└──────────────┴───────────────────────────────────┴──────────────────┘
```

- 右栏可折叠为 44px 图标条；折叠状态记忆。
- 窗口宽度 < 1100px 时右栏变抽屉；< 820px 左栏变抽屉。
- 桌面 Electron：窗口控制固定在右上角，不进入业务布局；原生壳不渲染。
- 顶栏只保留：标题、工作区面包屑、运行状态、右栏开关、`⋯` 菜单。

### 信息架构

- **Sidebar**
  - 顶部两个 tab：**会话 / 文件**
  - 会话 tab：品牌 + 新会话、**按工作区分组的会话文件夹（可折叠，文件夹右侧 + 新建会话）**、额度（折叠）、Bot/技能/插件/定时/设置
  - 会话标题：首轮后由模型总结生成；双击或右键可重命名，自定义标题不再被自动覆盖
  - 文件 tab：当前会话工作区的文件树；点 `.md` / 代码 / 图片在右侧预览，不离开对话
- **Chat**
  - 会话标签栏：像文件一样打开/关闭；关闭标签不删除会话，标签持久化
  - Header：标题、工作区、当前 Bot/模型、运行状态、更多菜单
  - Thread：消息、流式、计划卡、审批提示（inline，不浮层）
  - Composer：多行输入；工具条放 Bot、模型、思考、计划、附件、发送/停止；队列在输入框上方
- **Workbench**
  - Tabs：`状态` / `用量` / `上下文`
  - 状态：目标、清单、本轮改动、待审批、子代理/后台任务（后续）
  - 用量：上轮/本会话/总 token、缓存、按模型饼图（现有设置页的图移到这里）
  - 上下文：上下文占比、压缩、省下的 token、手动压缩
- **Secondary pages**（Bots/Skills/Plugins/Routines/Settings）
  - 沿用三栏壳：左栏保留，中栏变成页面内容（max-width 980），右栏隐藏或显示页面辅助信息
  - 统一 `PageHeader` + `Card` + `Table` + `Field`
- **Overlays**
  - 文件预览：右侧 520px 抽屉，Markdown 渲染 / 代码原样 / 图片；不阻断对话
  - Command palette（⌘K）
  - 确认对话框（删除/回滚）
  - 新建 Bot / 模型选择：右侧抽屉或居中 modal，二选一，统一宽度 520
  - Onboarding：独立全屏 3 步，不覆盖已加载应用

### 视觉 token

```css
--bg: #0b0c0d;            /* 石墨黑 */
--surface-1: #111315;     /* 面板 */
--surface-2: #171a1d;     /* hover/输入 */
--line: #24282c;
--line-strong: #343a40;
--fg: #f2eee6;
--fg-2: #b9b3a6;
--fg-3: #7f7a70;
--accent: #d8a657;        /* 黄铜 */
--accent-strong: #edc07a;
--success: #7fbf9a;
--warning: #d9a441;
--danger: #d97b6c;

--r-sm: 6px; --r-md: 10px; --r-lg: 14px;
--space: 8px 网格;
--font-ui: "Segoe UI Variable Text", "PingFang SC", "Microsoft YaHei UI", system-ui;
--font-mono: "Cascadia Code", Consolas, ui-monospace;
```

浅色：暖纸 `#f6f2e9` / 面板 `#fffdf8` / 文字 `#1d1b17`，强调色不变。

字体层级：11 / 12 / 13 / 15 / 18 / 24；对话正文 14px / 1.75；数字全部 tabular-nums。

### 组件 primitives（先建这些，再拼页面）

`Button`（primary/secondary/ghost/danger）、`IconButton`、`Field`、`Textarea`、`Select`、`Card`、`Tabs`、`Badge`、`Tooltip`、`Modal`、`Drawer`、`Toast`、`EmptyState`、`Progress`、`Kbd`、`Divider`、`Skeleton`。

任何页面不允许再写裸 `<button className="...">` 拼样式；统一走 primitives。

### 状态架构

```
api.ts（不变）
  ↓
useChatSession(sessionId)  ← useReducer
  state: messages / stream / queue / approvals / todos / checkpoints / stats
  actions: send / stop / retry / enqueue / decide / restoreCheckpoint
  ↓
ChatView / Composer / Workbench 只订阅需要的切片
```

- 会话状态按 `sessionId` 归一，不再在 App 顶层散落 40 个 useState。
- 事件先进入 reducer，再投影到 UI；同一事件只改一处。
- UI 局部状态（滚动、折叠、草稿）留在组件内。

---

## 三、文件结构（新前端）

```
packages/app/renderer/src/
  app/
    AppShell.tsx
    Sidebar.tsx
    Workbench.tsx
    routes.tsx
  chat/
    ChatView.tsx
    ChatHeader.tsx
    MessageStream.tsx
    Composer.tsx
    QueueBar.tsx
    ApprovalInline.tsx
  workbench/
    StatusPanel.tsx
    UsagePanel.tsx
    ContextPanel.tsx
  pages/
    BotsPage.tsx
    SkillsPage.tsx
    PluginsPage.tsx
    RoutinesPage.tsx
    SettingsPage.tsx
  ui/            ← primitives
  hooks/
    useChatSession.ts
    useWorkbench.ts
  styles/
    tokens.css
    base.css
    app.css
    chat.css
    workbench.css
    pages.css
  api.ts         ← 不动
  botIcons.tsx   ← 不动
```

旧 `App.tsx` / `panels.tsx` / `styles.css` 在 v2 对齐后删除。

---

## 四、迁移顺序（每步可回退）

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 | `?ui=v2` 开关 + tokens + primitives | 新旧可切换 |
| 1 | AppShell + Sidebar + 空聊天页 | 布局/响应式/主题 |
| 2 | 消息流 + 流式 + Markdown + 计划卡 | 历史会话可读 |
| 3 | Composer + 队列 + 停止 + 附件 + 任务卡 | 能完整发一轮 |
| 4 | Workbench：状态/清单/改动/审批/用量/上下文 | 右侧全部可用 |
| 5 | Bots / Skills / Plugins / Routines | 功能对齐 |
| 6 | Settings 五个 tab | 功能对齐 |
| 7 | Onboarding / 命令面板 / 删除确认 / 文件夹 | 边界状态 |
| 8 | 删旧 UI，视觉回归，原生壳/Electron 双端截图 | 一次切换 |

---

## 五、验收标准

- 1440 / 1280 / 1100 / 900 / 390 五个宽度无横向滚动、无遮挡。
- 深色/浅色/跟随系统三态；对比度 ≥ 4.5:1（正文）。
- 键盘：Tab 焦点可见、⌘K 命令面板、Enter 发送、Esc 关弹层。
- 空/加载/错误/断线/只读/运行中/审批中 七种状态都有设计，不是临时文字。
- 首屏不出现“仪表盘式”指标墙；所有指标在右栏。
- Electron 与原生壳截图一致（仅窗口控制差异）。

---

## 六、待确认

1. 主色保持黄铜，还是换成更冷的青/蓝？
2. 右栏默认展开还是折叠？
3. 浅色主题是否必须与深色同时首发？

默认按：**黄铜 + 深色默认 + 右栏展开 + 双主题首发** 执行。
