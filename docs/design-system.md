# TriBot 设计系统 v3 · Instrument

> 定位：**仪器感**。一套给「要卖」的产品用的界面语言——安静、精确、每个颜色都有理由。
> 规则来源：本仓库技能库里的 `hallmark`（反 AI 味的设计守则）与 `design-system`（三层 token 架构）。

![首页](screenshots/home.png)

## 1. 三层 Token

**Primitive（原始值）** — 只出现在 `:root` 顶部，别处不许写死颜色。

| 组 | 值 |
|---|---|
| 墨（背景） | `#08080A` `#0C0C0E` `#111113` `#161618` `#1C1C1F` `#242428` |
| 骨（文字） | `#F7F5F0` `#C9C5BC` `#97938A` `#6A675F` |
| 黄铜（强调） | `#F0CE8E` `#E3B261` `#C9954A` `#2A1F0E` |
| 状态 | 绿 `#8FD9A8` / 红 `#FF8A80` / 琥珀 `#F2C14E` |

**Semantic（用途）**

| Token | 指向 | 用在哪 |
|---|---|---|
| `--bg` / `--bg-side` | ink-950 / #060607 | 主区 / 侧栏（压暗一档） |
| `--surface-1/2/3` | ink-850/800/750 | 卡片 / hover / 选中 |
| `--line` `--line-2` `--line-3` | 骨色 7% / 12% / 20% | 发丝线 / 强调边 / 强边 |
| `--fg` `--fg-2` `--fg-3` | bone-50/300/500 | 正文 / 次要 / 提示 |
| `--accent` | brass-400 | 品牌、主操作、选中条 |
| `--focus-ring` | 3px 黄铜 22% | 所有可聚焦元素 |

**Component（组件）**

| Token | 用途 |
|---|---|
| `--btn-primary-bg/fg` | 主按钮（黄铜底、墨色字） |
| `--input-bg` | 输入框底色 |

## 2. 字体

- 正文：`Segoe UI Variable Text` → `PingFang SC` → `Microsoft YaHei UI`
- 标题/品牌：`Segoe UI Variable Display`，字距 `-0.012em`（中文不会散）
- 等宽：`Cascadia Code`（只用于 token 数、路径、编号，不用于标签）

字号阶梯：**10 / 11 / 12 / 13 / 13.5 / 20 / 34**；行高 1.5–1.75。
规则：一屏最多两种字号层级同时出现；标题只用 display 字体、一种字重。

## 3. 间距与形状

- 间距：4 的倍数（4/8/12/16/24/32）
- 圆角：控件 7–9，卡片 12，输入区 16
- 描边永远 1px，靠 `--line` 的透明度分层，**不用阴影堆叠**（浮层除外：审批卡、抽屉）

## 4. 组件状态（以主按钮为例）

| 状态 | 背景 | 文字 | 边框 |
|---|---|---|---|
| 默认 | brass-400 | `#171106` | 同底色 |
| hover | brass-300 | 同 | 同 |
| active | brass-500 | 同 | 同 |
| disabled | surface-3 | fg-3 | 无 |
| focus-visible | 同默认 + 3px 环 | 同 | 同 |

所有交互元素都有 `:focus-visible`；所有动画都有 `prefers-reduced-motion` 兜底。

## 4.5 下拉菜单（自绘，替代原生 select）

原生 `<select>` 的弹层是系统样式，和整页不搭，所以输入区的「思考 / 路由 / 模型」三个菜单都是自绘：

| 部分 | 规格 |
|---|---|
| 触发器 | 高 26，透明底；`标签(10.5, fg-3) + 值(11.5, fg-2) + 箭头(11)`；hover 底色 `surface-2`；展开时加 `line-2` 边 |
| 弹层 | 向上展开（`bottom: 100% + 7px`），`ink-800` 底、`line-2` 边、圆角 10、阴影 `0 18px 44px` |
| 选项 | 名称 12 + 说明 10.5；hover / 选中用 `surface-3`；选中项右侧黄铜对勾 |
| 状态色 | 思考档位语义化：`深度` 的值用黄铜，`快速` 压暗到 fg-3 |
| 交互 | 点外部关闭、`Esc` 关闭、`aria-expanded` / `role=listbox` / `aria-selected` |

![思考菜单](screenshots/thinking-menu.png)

## 5. 从技能库里采纳的硬规则

来自 `hallmark` 的 Floor（不可协商）：

1. 颜色和字体只能走 `:root` 的 token，别处不许写死
2. 禁止 `transition: all`；只动 `transform` / `opacity` / 颜色
3. 禁用 emoji 当图标（本项目全部用内联 SVG）
4. 每个可交互元素必须有 `:focus-visible`
5. 一个屏幕一个主张，标题不超过 7 个词
6. 不用紫蓝渐变、不套卡片、不画假浏览器窗口
7. 不做 tracked caps 小标签（中文 UI 尤其难看）

来自 `design-system` 的结构：

1. 三层 token，语义层不许绕过原始层直接写值
2. 组件状态表先定，再写实现
3. 同类组件只允许一个主样式（主按钮只有一种）

## 6. 界面

**对话（真实执行中，含审批卡与配额）**

![对话](screenshots/thread.png)

**技能库（本机安装的设计技能）**

![技能库](screenshots/skills.png)

## 6.5 主题

同一套 token，两套取值：`html[data-theme="light"]` 覆盖 primitive 与语义层，组件层不用改。

- 深色：墨底 + 骨白字 + 黄铜
- 浅色：暖白底（`#f4f2ed`，不用纯白）+ 墨色字 + 压深的黄铜（`#b07c33`，保证对比度）
- 跟随系统：`prefers-color-scheme`，顶栏按钮可循环「跟随系统 → 深色 → 浅色」
- 所有叠加层用 `--lift-1/2/3`、阴影用 `--shadow-strong`，浅色下自动换成黑色叠加

![浅色主题](screenshots/light.png)

## 7. 卖之前的进度

- ✅ App 图标（`packages/app/assets/icon.png`，黄铜 + 墨色闪电）
- ✅ 无边框窗口 + 自绘窗口按钮（修掉 Windows 顶部的浅色白边）
- ✅ 首次启动引导（三步：介绍 → 配模型 → 选任务文件夹）
- ✅ 落地页（`site/index.html`，含实测数字与三张截图）
- ✅ 亮色主题（跟随系统 / 深色 / 浅色，顶栏一键切）
- ✅ 便携版打包（`pnpm package` → `release/TriBot-win32-x64/TriBot.exe`）
- ⬜ NSIS 安装包与代码签名

![上下文洞察](screenshots/context.png)

面板顶部是本会话累计省下的 token 与折合金额，下面才是各段占用。
