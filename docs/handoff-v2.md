# TriBot 交接文档（handoff-v2）

> 面向新接手的开发者。目标：读完能理解整体架构、各模块职责、知道怎么启动、避开已知坑点。
> 本文所有路径与命令均于 2026-10-29 对照仓库实际代码核验（命令与 `package.json` scripts 逐一核对，文档过时处以代码为准，差异见 §5.14）。

---

## ① 项目概述与技术栈

TriBot 是一个**本地 Bot 团队工作台**（类 Grok Bot：总管/研究员/工程师/管家/审稿人五个角色分工协作），同一仓库承载两种形态：

1. **Agent 技能**（`SKILL.md`，仓库根目录）：纯指令型插件，装进 DSH / ZCode 等兼容 Agent 即可让单个 Agent 切换五种工作模式。零配置、无代码、无密钥。
2. **桌面版**（`packages/*` monorepo）：跑在本机的 Electron 工作台，Bot 拥有真实工具（读写文件、执行命令、浏览器、桌面自动化、MCP），带审批、沙箱、检查点回滚、用量统计。数据不出本机。

### 技术栈

| 项 | 值 | 依据 |
|---|---|---|
| 语言 | TypeScript（`^7.0.2`，strict，noEmit，ES2023/NodeNext） | `tsconfig.base.json`、各包 devDependencies |
| 运行时 | Node.js **>= 22.5**（engines；本机实测 v24.19.0 可用；版本口径注意点见 §5.2） | `package.json` |
| 包管理 | pnpm workspace（`packageManager: pnpm@12.6.0` 锁定） | `package.json`、`pnpm-workspace.yaml` |
| 桌面壳 | Electron `^45.1.0`（另有 C#/Python 原生壳，见 §3） | `packages/app/package.json`、`shell/` |
| 前端 | React 19 + Vite 8（渲染层） | `packages/app/package.json`、`packages/app/renderer/vite.config.ts` |
| 后端 | Fastify 5（REST + SSE，只绑 127.0.0.1） | `packages/server/package.json`、`packages/server/src/index.ts:1200` |
| 存储 | Node 内置 `node:sqlite`（`DatabaseSync`），无外部数据库 | `packages/core/src/db.ts:3` |
| 测试 | Vitest 5（仅 core / server 两个包有 test script） | 各包 `package.json` |
| 构建 | esbuild（主进程/server bundle）+ Vite（渲染层） | `packages/app/scripts/dev.mjs`、`scripts/package-portable.mjs` |
| 其他关键依赖 | playwright-core（浏览器工具）、cron-parser（定时任务）、yaml、pdfjs-dist、react-markdown | `packages/core/package.json`、`packages/app/package.json` |
| 模型供应商 | 内置 GLM / MiniMax / DeepSeek（OpenAI 兼容协议），可加任意自定义供应商；联网搜索用 Tavily（可选） | `packages/shared/src/index.ts:4`、`.env.example` |

---

## ② 架构

### 2.1 目录结构

```
Tribot/
├── SKILL.md                  # 技能本体（DSH/ZCode 共用一份，含 when_to_use/whenToUse 双字段）
├── packages/                 # pnpm workspace 全部成员（packages/*）
│   ├── app/                  # Electron 主进程 + React 渲染层 + dev/打包脚本
│   ├── server/               # Fastify REST + SSE 服务
│   ├── core/                 # Agent 引擎（路由/工具/审批/沙箱/压缩/SQLite…）
│   ├── cli/                  # tb 命令行（零依赖，纯 HTTP 客户端）
│   └── shared/               # 三端共享类型与协议（无运行时依赖）
├── scripts/                  # 打包、基准、评测脚本（被根 package.json scripts 调用）
├── shell/                    # 不用 Electron 的原生壳：Windows C# + WebView2；mac/Linux Python
├── site/                     # 静态下载站（index.html + style.css）
├── integrations/dsh-role-picker/  # DSH 客户端插件：输入框旁「选择角色」胶囊
├── skills/                   # 其它技能（design-system、hallmark）
├── dsh-skills/ zcode-skills/ # 两端技能安装说明（README；本体都是根 SKILL.md）
├── data/                     # 运行时数据（gitignore）：tribot.db、凭证密文、daemon.json、工作区…
├── docs/                     # 设计与说明文档（本文所在处）
├── release/ .cache/ .tmp/ .shots/  # 打包产物与缓存（gitignore，勿读勿提交）
└── package.json pnpm-workspace.yaml tsconfig.base.json .env.example .npmrc .gitignore
```

### 2.2 workspace 成员与依赖方向

`pnpm-workspace.yaml` 只声明 `packages/*`，实际 5 个成员（以各自 `package.json` 的 `name` 为准）：

```
@tribot/shared ← @tribot/core ← @tribot/server ← @tribot/app
                                                   ↑（dev 依赖 core/server 做 typecheck）
@tribot/cli（独立，零依赖，运行时只走 HTTP）
```

### 2.3 数据 / 控制流

**开发启动流**（`pnpm dev` → `packages/app/scripts/dev.mjs`）：

```
1) esbuild 打包 electron/server-entry.ts → build/server.cjs
                          electron/main.ts       → build/main.cjs
                          electron/preload.ts    → build/preload.cjs
2) fork server.cjs（随机空闲端口，注入 TRIBOT_ROOT / TRIBOT_PORT / TRIBOT_AUTOSTART=1）
3) 起 vite 渲染层（随机端口，-c renderer/vite.config.ts）
4) 等 vite 就绪 → 启动 Electron（注入 TRIBOT_DEV_URL），任一进程退出即全部收尾
```

**运行时控制流**：

```
React 渲染层 (packages/app/renderer/src/)
  → api.ts：HTTP + SSE 到 http://127.0.0.1:<port>（端口来自 URL ?port=，存 localStorage，兜底 47615）
  → Fastify server (packages/server/src/index.ts，58 条 /api/* 路由，另有 / 与 /assets/* 静态托管打包后的渲染层)
  → engine.runChat (packages/core/src/engine/index.ts)
      路由 (router/：auto | manual | failover | compare + 健康记分)
      → LLM 客户端 (llm/client.ts，OpenAI 兼容 chat/completions，流式)
      → 工具循环 (tools/：17 个工具，沙箱锁工作区 + 高危审批 ApprovalService + 写前文件快照 checkpoints)
      → 上下文管理 (engine/compress.ts 长输出落盘 expand_output 读回；memory.ts 分段读文件/摘要压缩)
  → SQLite (node:sqlite) data/tribot.db + 工作区文件 + 凭证密文 data/credentials.json
```

**进程与端口**：

- 生产/Electron 模式：`main.ts` 拉起 `server.cjs` 子进程（`ELECTRON_RUN_AS_NODE=1`），轮询 `/api/health`，端口优先读 `data/daemon.json`，默认 47615（`TRIBOT_PORT` 可覆盖）。
- server 启动时把 `{port, pid}` 写进 `data/daemon.json`（`packages/server/src/index.ts:1192-1223`），CLI 与 App 靠它发现端口；`EADDRINUSE` 自动 +1 重试（最多 10 次）。
- CLI（`packages/cli/tb.mjs`）端口发现顺序：`--port` > `TRIBOT_PORT` > `data/daemon.json` > 47615，与桌面 App 共用同一个 server。
- Electron 主进程还负责：单实例锁、userData 收到 `data/electron`（避开 %APPDATA% 权限问题）、DPAPI（safeStorage）主密钥 `data/.masterkey`（AES-256-GCM 加密凭证）、无边框窗口 + 托盘常驻（`packages/app/electron/main.ts`）。渲染层与主进程之间只走窗口控制/选文件夹/读附件的 IPC 桥（`packages/app/electron/preload.ts`），业务数据全走 HTTP/SSE。

---

## ③ 模块职责

### packages/（workspace 成员）

| 包 | 职责 | 关键入口 |
|---|---|---|
| `@tribot/shared` | 三端共享的**类型与协议**：Provider/Bot/Session/Message/Approval/Routine/StreamEvent 等，外加默认设置 `DEFAULT_SETTINGS`（沙箱三档、命令白名单、思考触发词）。纯类型+常量，无运行时依赖 | `src/index.ts` |
| `@tribot/core` | **Agent 引擎**，全部业务逻辑：env/凭证（AES-256-GCM + DPAPI 主密钥）、`node:sqlite` 建库（db.ts SCHEMA）、模型注册表与三家预设、路由与 failover 健康记分、配额（5h 窗口/周额度/DeepSeek 低谷半价）、17 个工具（文件读写锁工作区、run_command 白名单+审批、http_fetch、web_search、browser、desktop、mcp_list/mcp_call、use_skill、assign 总管分派、expand_output、todo_write、exit_plan_mode…）、审批门（once/session/always 授权）、检查点回滚、技能(SKILL.md)加载、插件市场、五角色提示词（bots/roles.ts）与内置 Bot 播种、Routine 定时调度 | `src/index.ts`（总出口）、`src/engine/index.ts` |
| `@tribot/server` | **Fastify REST + SSE**：组装全部 `/api/*` 路由（会话/消息/文件预览/检查点/审批/授权/技能/插件/市场/Routine/配额/统计/设置/皮肤），`POST /api/chat` 用 SSE 推 `StreamEvent`；只绑 127.0.0.1；`buildTriBot()` 可嵌入 Electron，`startServer()` 独立进程并写 daemon.json | `src/index.ts` |
| `@tribot/app` | **桌面壳**：`electron/main.ts`（进程编排/托盘/主密钥/单实例）、`electron/preload.ts`（IPC 桥）、`renderer/`（React 工作台：会话标签、文件侧栏、审批面板、设置），dev 与打包脚本在 `scripts/dev.mjs`、`scripts/dev-server.mjs` | `package.json` main=build/main.cjs |
| `@tribot/cli` | **tb 命令行**：单文件 `tb.mjs`，零依赖；子命令 chat / ask / bots / quota / sessions / skills / routines / status，走同一本地 server | `tb.mjs` |

### 顶层目录

| 目录 | 职责 |
|---|---|
| `scripts/` | `bench.mjs`（省 token 实测，esbuild 打包 bench-context.ts 后运行）、`bench-speed-matrix.mjs`、`eval-roles.mjs`（角色评测）、`package-portable.mjs`（Windows 便携版）、`package-installer.mjs`、`package-target-installers.mjs`（下载站产物）、`package-native-shell.mjs`（C# 原生壳） |
| `shell/` | 无 Electron 的原生壳：`TriBotShell.cs`（WinForms + WebView2，起 `runtime/node.exe` 跑 `app/build/server.cjs`）、`tribot_shell.py`（mac/Linux，pywebview + 系统 WebView） |
| `site/` | 静态下载站（`index.html` + `style.css`），部署说明见 `site/README.md` |
| `integrations/dsh-role-picker/` | DSH 客户端插件（`dsh.plugin.json` + `src/` + `build.mjs`），输入框注入「选择角色」 |
| `skills/`、`dsh-skills/`、`zcode-skills/` | 附属技能与安装文档；`SKILL.md` 本体在仓库根目录 |
| `data/` | 运行时状态：`tribot.db`、`credentials.json`（密文）、`.masterkey`/`.localkey`/`.shellkey`、`daemon.json`、`dev.log`/`server.log`、`workspaces/`、`skills/`、`skins/`、`tool-outputs/`、`electron/`。整体 gitignore |

---

## ④ 启动方式

### 环境要求

- **Node.js >= 22.5**（`package.json` engines；本机实测 v24.19.0；版本口径注意点见 §5.2）
- **pnpm 12.6.0**（`packageManager` 字段锁定；本机实测 12.6.0）
- **Windows** 为主力平台：打包脚本产出 win32-x64、主密钥用 DPAPI、原生壳是 C#；mac/Linux 无打包链（`package:targets` 产出的 mac/linux 包是源码+安装脚本，目标机自下 Electron，见 `site/README.md`）
- 国内网络：`.npmrc` 已指向 npmmirror（registry + electron 镜像），海外可删

### 安装

```bash
pnpm install
```

### 日常开发（根目录命令，与根 package.json scripts 一致）

```bash
pnpm dev            # 桌面 App：esbuild 打包 → server 子进程 + vite + Electron 一条龙
pnpm dev:server     # 只起本地 server（默认 127.0.0.1:47615；数据目录 <项目>/data）
pnpm test           # 全部单测（实际只有 @tribot/core、@tribot/server 有 test script，vitest run）
pnpm typecheck      # 全仓类型检查（shared/core/server 各 tsc --noEmit；app 跑 renderer+electron 两个 tsconfig）
```

```bash
# 单独类型检查某个包（子包 scripts，用法与 glm-tasks.md 一致）
pnpm --filter @tribot/app typecheck
pnpm --filter @tribot/core typecheck
```

### 命令行 CLI

```bash
pnpm cli -- status     # server 健康检查（需先 pnpm dev 或 pnpm dev:server）
pnpm cli -- chat       # 交互聊天
pnpm cli -- ask "问题"  # 单次提问（--bot 总管 --model <id> 等参数见 tb help）
pnpm cli               # 不带参数打印全部子命令
```

### 基准与评测

```bash
pnpm bench             # 省 token 基准（产出数据见 docs/token-benchmark.md）
pnpm bench:speed       # 速度矩阵
pnpm eval:roles        # 角色评测
```

### 打包（产物均进 release/，gitignore）

```bash
pnpm package           # Windows Electron 便携版 → release/TriBot-win32-x64/TriBot.exe
pnpm installer         # 安装器
pnpm package:targets   # 下载站产物（win/mac/linux zip/tar.gz → site/downloads/）
pnpm package:native    # C# + WebView2 原生壳 → release/TriBotNative/
```

注意：`pnpm package` 第 2/5 步内部会跑 `vite build -c renderer/vite.config.ts` 构建渲染层（`scripts/package-portable.mjs:37-49`），打包前先关掉正在运行的 TriBot（清理 release 目录失败会直接 throw）。

### 首次启动

1. `pnpm dev` → 三步引导；或 `pnpm dev:server` + 浏览器。
2. 设置 → 模型与凭证：填至少一家 API Key（界面填写会写回项目根 `.env`，`packages/core/src/config.ts` 的 `setEnvKey`）；也可复制 `.env.example` 为 `.env` 手工填 `TRIBOT_GLM_API_KEY` / `TRIBOT_MINIMAX_API_KEY` / `TRIBOT_DEEPSEEK_API_KEY`（可选 `TRIBOT_TAVILY_API_KEY`、`TRIBOT_DATA_DIR`、`TRIBOT_PORT`）。
3. 新建会话，把任务丢给总管（或选其他角色）。

### 改完 SKILL.md 同步到本机 Agent（README「开发」节）

```bash
cp SKILL.md ~/.dsh/skills/tribot/SKILL.md
cp SKILL.md ~/.zcode/skills/tribot/SKILL.md
```

---

## ⑤ 已知坑点（均有代码依据）

1. **`pnpm dev:web` 单独跑不可用（实测）**：root script 是 `vite` 无参数，cwd 在 `packages/app`，不会加载 `renderer/vite.config.ts`（该目录无 index.html）。实测起在 5173 且 `GET /` 返回 404。要单独预览渲染层，用 `pnpm --filter @tribot/app exec vite -c renderer/vite.config.ts`（与 dev.mjs、`glm-tasks.md` 的用法一致），且通常还需 `pnpm dev:server` 提供后端；日常直接 `pnpm dev`。
2. **node:sqlite 版本口径**：`packages/core/src/db.ts` 直接 `import { DatabaseSync } from 'node:sqlite'`，而 engines 只要求 `>=22.5`。node:sqlite 在早期 Node 22.x 小版本是实验特性、需要 `--experimental-sqlite` 才能加载（官方文档口径，本次环境无外网未能复核原始页面）；本机 Node v24.19.0 实测无 flag 直接可用。新机器建议直接上 Node 22.13+ / 24 LTS，装完先跑 `node -e "require('node:sqlite')"` 自检。
3. **文档路径漂移（以代码为准）**：`docs/tribot-desktop.md:164` 写插件源码在 `dsh-plugins/tribot-role-picker`、`:168` 写技能源文件在 `zcode-skills/tribot/SKILL.md`——两个路径都不存在；实际是 `integrations/dsh-role-picker/` 和仓库根 `SKILL.md`（`dsh-skills/README.md`、`zcode-skills/README.md` 指向正确）。tribot-desktop.md:47 写「pnpm >= 10」，仓库实际锁定 pnpm@12.6.0。
4. **esbuild bundle 的 external 红线**：打包 server/main/preload 时必须 `external: ['electron','playwright-core','chromium-bidi','chromium-bidi/*']`——chromium-bidi 未随包安装，打进 bundle 会让 esbuild 直接解析失败（`packages/app/scripts/dev.mjs:51-53` 注释）；playwright-core 也不能 bundle（依赖自身 browsers.json），要以真实包随应用携带（`scripts/package-portable.mjs:64-68`）。
5. **渲染层 base 必须是相对路径**：打包后是 `file://` 加载，`vite.config.ts` 在 build 模式强制 `base: './'`——注释明示否则 `/assets/*` 解析到盘符根 → 黑屏。
6. **server 根路径只托管打包产物**：`packages/server/src/index.ts:275-277` 托管 `__dirname/renderer/index.html`（即 `packages/app/build/renderer/`），没构建过会返回 404「还没有构建前端：先 pnpm package」。纯 `pnpm dev:server` 调浏览器 UI 时，要么先构建渲染层，要么走 vite 的端口。
7. **端口行为**：默认 47615；`pnpm dev` 下 server 和 vite 都用**随机空闲端口**（dev.mjs `freePort()`），端口经 `?port=` 传给渲染层并记进 localStorage（`renderer/src/api.ts:9-16`）——所以「浏览器里打开 47615 连不上 dev 会话」是正常现象。server 被占用时自动 +1 重试并更新 daemon.json。
8. **Windows 下 esbuild/vite 临时文件被锁**：Defender 会锁系统 TEMP 里的 esbuild 临时文件，`package-portable.mjs` 构建渲染层时把 `TEMP/TMP` 改到 `.cache/esbuild-tmp`；vite watcher 对 `*.tmp`/`*.tmpdir` 抛 EBUSY，已在 `vite.config.ts` 忽略。
9. **`data/` 是活的状态目录**：tribot.db、凭证密文、daemon.json、日志、工作区都在里面，整体 gitignore（`.gitignore:4`）；表结构只有 `packages/core/src/db.ts` 的 `SCHEMA` 一处，改表要兼容老库（参考 `seed.ts` 和 server 里「老库设置补默认值」的写法）。
10. **内置 Bot 提示词的升级逻辑**：`seedBots()`（`packages/core/src/bots/seed.ts`）只覆盖「以【身份】/你是「/你是 TriBot 的 开头」的历史提示词（`isOurs`），用户改过的不动；`thinking` 只补空不覆盖。改角色提示词（`bots/roles.ts`）时要理解这套迁移规则，别假设所有用户库都会跟着更新。
11. **测试覆盖范围**：只有 `packages/core/tests/*.test.ts`（20 个文件）和 `packages/server/tests/stop.test.ts`；app/cli/shared 没有 test script，`pnpm -r --if-present test` 会静默跳过——别以为 `pnpm test` 绿了 UI 就没回归。
12. **发布包必须排除敏感物**：`data/`、`.env`、`credentials.json` 均在 `.gitignore`；API Key 只回显尾号（`config.ts` `maskKey`），凭证 AES-256-GCM 密文 + DPAPI 主密钥（`electron/main.ts:85-107`）。排查打包产物时确认没把这些带进 `release/`。
13. **Electron 窗口行为**：关闭窗口 = 真正退出（`main.ts:192-193` 注释：此前是隐藏到托盘，看起来像没反应，已改）；后台常驻由托盘「隐藏窗口」承担；单实例锁，第二个实例只会唤起已有窗口。
14. **README/文档 vs 代码核对结论**：README「开发」节的 `pnpm install/test/typecheck/bench` 与根 package.json 一致 ✓；README「仓库里还有什么」的 packages 列表一致 ✓；`docs/tribot-desktop.md` 的「常用命令」表中 `pnpm cli -- chat`、`pnpm package*` 均与 scripts 一致 ✓，唯 `pnpm dev:web` 一行与实际行为不符（见坑点 1），以及坑点 3 的路径漂移。其余文档（design-system、native-shell、roles、security 等）未逐字核对，引用前建议先验证其中路径。

---

*本文档由工程师角色生成于 2026-10-29；核验方式：所有路径经 glob/read 实证，命令与根/子包 package.json scripts 逐字比对，`pnpm typecheck` 实跑通过，`pnpm dev:web` 行为实跑复现。*
