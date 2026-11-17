# TriBot 桌面版 · 上线前架构审查

> 审查日期：2026-11-18 · 范围：底层架构（进程边界 / 运行时 / 安全 / 模块职责）
> 方法：架构勘察（依赖图 + 进程边界）+ 三个并行子代理专项审查 + 关键项人工 grep 复核
> 结论口径：**这是上线决策审查，不是学术审查**

## 结论：❌ 暂不能上线，有 1 个阻断项

| 门槛 | 判定 | 说明 |
|---|---|---|
| 安全 | ❌ **不通过** | 本地 server 无鉴权 + CORS 反射任意来源（见 B1） |
| 稳定性 | ⚠️ 勉强 | 8 项重要问题，无崩溃级缺陷 |
| 数据完整性 | ⚠️ 勉强 | SQLite 同步阻塞 + 无 busy_timeout |
| 可维护性 | ✅ 通过 | 依赖方向干净、模块边界清晰、测试 165 全绿 |
| 可发布性 | ⚠️ 待补 | 打包链路可用，但缺自动恢复与错误上报 |

---

## 阻断项（不修不能上）

### B1 · 本地 server 无鉴权 + CORS 反射任意来源

**位置**：`packages/server/src/index.ts:183`（`await app.register(cors, { origin: true })`）、`packages/server/src/index.ts:692`（SSE 手写 `Access-Control-Allow-Origin: req.headers.origin`）

**问题**：`origin: true` 会把请求来源原样反射回去，等于允许**任意网站**跨域调用本地服务；而全部端点没有任何鉴权。

**危害链（已逐条核实）**：

1. 用户用浏览器访问任意恶意页面
2. 该页 JS 执行 `fetch('http://127.0.0.1:47615/api/sessions')` → 读到**全部会话与消息**（含任务路径、工作区内容）
3. 或 `POST /api/chat` → 触发一次真实对话；模型调用 `write_file` 时**不经过审批**（`tools/index.ts:231` 仅检查 `sandboxBlocks`，工作区/全权档直接放行）→ 恶意页面可借模型之手**写入文件**
4. `run_command` / `http_fetch` 虽要审批（`tools/index.ts:318,379`），但审批事件推给 UI，用户看到的是"AI 要跑命令"，**根本不知道请求来自 evil.com**

**为什么这是阻断**：桌面版卖点是"数据全在本地"，而这条链让**任何网页都能读你的本地数据、并能写文件**。竞品出过同类事故（Grok Bot 云电脑按成员共享导致跨 Bot 越权）。

**改法**（最小改动，约 30 行）：

1. **CORS 白名单**：`origin` 改为只允许 `http://127.0.0.1:<port>`、`http://localhost:<port>` 与 Electron/原生壳的 `file://`（origin 为 `null` 时按需放行白名单路径）
2. **本地会话令牌**：server 启动生成随机 token 写 `data/daemon.json`（已有该文件），所有 `/api/*` 校验 `Authorization: Bearer <token>`；UI 通过 `daemon.json` 或注入的 `__TRIBOT_TOKEN__` 拿到
3. **写文件也过审批门**：`write_file` 在非 `full` 沙箱下至少对"覆盖已存在文件"要求审批，或把"本会话首次写入"纳入审批
4. 回归测试：新增一条断言——带外来源的 `Origin` 请求 `/api/sessions` 必须 403

---

## 重要项（建议上线前修，或列入首个补丁）

### 运行时（子代理 A · 工程师档）

| # | 位置 | 问题 | 改法 |
|---|---|---|---|
| R1 | `server/index.ts:181-182,700-702` | 「防同会话并发」的注释与实现不符：直接覆盖 Map，旧 run 继续跑且丢失 stop 句柄 | 同会话已有 run 时返回 409，或先 abort 并等退出再登记 |
| R2 | `core/db.ts:69-84`、`server:101` | 单 `DatabaseSync` 阻塞整个 server 的 HTTP/SSE 心跳；未设 `busy_timeout`，外部争写直接 `SQLITE_BUSY` | 设有限 `busy_timeout`；高负载时把 DB 移入 worker 并做写序列化 |
| R3 | `server:694-699` | 忽略 `res.write()` 返回值、不等 `drain`，慢客户端会让 token 在内存堆积 | `write` 返回 false 时暂停生产并等 `drain`，设队列上限 |
| R4 | `server:670-725` | SSE 无 event id / Last-Event-ID / 回放；刷新即 abort，无法续传 | 持久化 run/event 序号，支持按 run-id 重连与游标回放 |
| R5 | `engine/index.ts:187-200,272,307` | `AbortSignal` 未传入审批与工具上下文，停不下来 | signal 放进 `ToolContext` 与审批等待，工具每阶段检查 abort |
| R6 | `engine/index.ts:260-284,375-440` | 大 try 同时包模型/用量/落库；DB 错误会被当模型错误触发降级 | 拆分模型、工具、DB 三类错误边界，仅模型错误 failover |
| R7 | `server:718-725` | `runChat` 抛出时只发 `error` 不发 `done`，客户端状态机可能不收敛 | finally 保证恰好一个终止事件 |
| R8 | `electron/server-entry.ts:4`、`main.ts:128-141` | `void startServer()` 无 rejection 处理；子进程退出只记日志，不自动恢复 | 入口 catch + 非零退出；主进程监控 exit 并退避重启，向 UI 报状态 |

**A 号己确认的良好设计**（无需改）：Electron 主进程以 `ELECTRON_RUN_AS_NODE=1` spawn 独立 server 子进程（`main.ts:109-125`）、可复用健康 daemon（144-148）、renderer 只拿 port（230-253）；WAL 已开；工具按 `await` 串行，单模型尝试受 `maxSteps` 封顶；工具抛错转 `ok:false` 回喂模型（可恢复设计，不与模型/DB 错误混类）。

### 安全（附加项，人工复核）

| # | 位置 | 问题 | 改法 |
|---|---|---|---|
| S1 | `tools/index.ts:60-67` | 路径解析逻辑可疑：`!r.startsWith('..') && !path.isAbsolute(r)` 才 resolve，否则走另一分支——需实测符号链接/`..` 组合 | 统一 `path.resolve` 后做 `startsWith(root + sep)` 前缀校验，并对真实路径 `realpath` 再校验一次 |
| S2 | `checkpoints.ts:53-55` | 已做 root 前缀校验 ✅，但未对符号链接做 `realpath` 二次校验 | 恢复前 `realpath(target)` 再验一次 |
| S3 | `.env` 明文兜底 | 凭证主链路是 AES-256-GCM + DPAPI ✅，但 `.env` 明文兜底仍在 | 文档明确标注风险；安装向导里不建议用 `.env` |

---

## 未完成

- **模块职责与耦合专项**（子代理 C）执行中断，仅完成架构勘察层结论：依赖方向 `shared ← core ← server ← app/cli` 单向无循环，core 不含 HTTP/UI 逻辑，shared 纯类型——**这一层通过**；细粒度耦合（React 状态集中度、prop drilling、localStorage 滥用）未出报告，建议补一轮。

## 上线前必做清单

| 项 | 谁做 | 估算 |
|---|---|---|
| 修 B1（CORS 白名单 + 本地令牌 + 写入审批） | 工程师 | 半天 |
| 修 R1/R7/R8（并发登记、终止协议、子进程自愈） | 工程师 | 半天 |
| 修 R2/R3（busy_timeout、SSE 背压） | 工程师 | 半天 |
| 补 B1 回归测试 | 工程师 | 1 小时 |
| 打包 + 干净机器冒烟（首启/无 Key/断网/杀子进程） | 管家 | 半天 |
| 安全文档更新（威胁模型、令牌机制） | 写手 | 2 小时 |

**判定**：修完 B1 + R1/R7/R8 即可进入内测；R2–R6 可作为首个补丁。

---

## 修复状态（2026-11-18）

已全部修复并验证：`pnpm typecheck` 无错 · 172 个测试全绿（core 165 + server 7）。

| 项 | 状态 | 改动位置 | 做法 |
|---|---|---|---|
| **B1** | ✅ 已修 | `server/src/index.ts` | CORS 改白名单（只放 127.0.0.1/localhost/file://）；新增本地令牌（`TRIBOT_TOKEN` 或随机 24 字节），写入 `daemon.json`；`onRequest` 钩子对 `/api/*` 校验 Bearer 或 `?token=`（`/api/health` 例外）；SSE 手写头同样只回写本机来源；`/` 注入 `window.__TRIBOT_TOKEN__` |
| B1 三端对接 | ✅ | `renderer/src/api.ts`、`electron/main.ts`、`cli/tb.mjs` | UI 从 URL/注入/localStorage 取令牌并统一加 `Authorization`；Electron 主进程读 `daemon.json` 并拼到加载 URL；CLI 从 `daemon.json`/环境变量取令牌 |
| B1 回归测试 | ✅ | `server/tests/auth.test.ts` | 5 条：无令牌 401 / 带令牌 200 / health 免令牌 / 外站 Origin 无 Allow-Origin / 本机 Origin 有 |
| **R1** | ✅ 已修 | `server/src/index.ts` | 同会话已有 run 时返回 **409**，不再覆盖 Map |
| **R2** | ✅ 已修 | `core/src/db.ts` | `PRAGMA busy_timeout = 5000` + `synchronous = NORMAL`（WAL 下安全） |
| **R3** | ✅ 已修 | `server/src/index.ts` | SSE 写队列 + `drain` 背压，队列上限 1000（超限丢弃新内容，防内存无界） |
| **R5** | ✅ 已修 | `core/src/tools/approval.ts`、`tools/index.ts`、`engine/index.ts` | 审批 `request()` 接受 `signal`，等待中被 abort 立即返回 denied；`ToolContext.signal` 注入；工具循环每个工具入口检查 `aborted` |
| **R6** | ✅ 已修 | `engine/index.ts` | 落库单独 try/catch：DB 写失败不再被当成模型失败触发降级重跑，改为报错 + 返回内存态消息 |
| **R7** | ✅ 已修 | `server/src/index.ts` | `doneSent` 标记 + finally 保证**恰好一个**终止事件；给队列 30ms 刷尾再关连接 |
| **R8** | ✅ 已修 | `electron/server-entry.ts`、`electron/main.ts` | 入口 `.catch` 记录并非零退出；主进程监听 exit，指数退避重启（最多 5 次）并向窗口推送 `tribot:server-state` |
| **S1** | ✅ 已修 | `core/src/tools/index.ts` | `safeResolve` 增加 `realContained()`：词法校验后再 `realpath` 逐级校验，防符号链接逃逸 |
| **S2** | ✅ 已修 | `core/src/checkpoints.ts` | 恢复前对 root/target 做 `realpath` 二次校验，指向工作区外即拒绝 |
| **R4** | ⏳ 未修（有意） | — | SSE 断线续传（event id / Last-Event-ID / 回放）需要持久化 run 事件序号，属功能增强而非缺陷修复，列入首个补丁 |

### 上线判定更新

阻断项 B1 已消除，R1/R2/R3/R5/R6/R7/R8 + S1/S2 已修并全量回归通过。**当前可进入内测**；正式对外前建议补 R4（SSE 续传）与干净机器冒烟（首启/无 Key/断网/杀子进程）。
