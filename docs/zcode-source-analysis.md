# ZCode 源码分析：哪些该学，哪些别学

> 分析对象：`https://github.com/zai-org/ZCode`（浅克隆到 `.cache/ZCode`）
> 规模：9,158 个 TS/TSX 文件、约 207 万行；`apps/zcode-cli` 2,845 文件，`packages/ui` 3,060 文件。
> 结论先行：**运行时设计值得学，前端状态管理和工程治理不要照抄。**

---

## 一、整体架构：四层 + 一条事实链

```
shared ← rpc ← services ← client ← server
                   ↑          ↑
                  ui     desktop / web
```

- **Main Process**：只做窗口、原生对话框、进程 fork、MessagePort/远控 attachment 中转，不持有 session/task/stream 状态。
- **Window Host**：每个窗口一个 Host；本地每个 `workspaceKey` 最多一个 `zcode-cli` 子进程；远程 workspace 由同一 Host 管理连接与 scoped services。
- **Renderer**：只保留草稿、滚动、焦点等视觉状态；业务事实通过 hooks/service proxy 订阅 snapshot/delta。
- **zcode-cli**：唯一权威状态源，持有 session/core runtime、command inbox、queue、goal、tool、model runtime。

关键协议：

- Electron ↔ Agent 走 `zcode app-server --stdio` 的 NDJSON，JSON-RPC 风格 envelope。
- `@zcode/rpc` 把 MessagePort / WebSocket / SSH stdio 统一成 `IMessagePassingProtocol`。
- 会话有单调 `eventSeq`；桌面 `desktop-continuous` 实时流，手机 `web-remote-replayable` 用 snapshot + afterSeq 补 gap，两条链路严格隔离。
- 数据流：`UI command → Host transport → CLI command inbox → core events → ProductProjection → snapshot/delta → UI rows`。

**可学点**：状态所有权清晰——UI 不维护第二份权威会话；所有变更走 command，所有展示走 projection。TriBot 目前是 renderer 直接改 messages/streams/queue，简单但很快会变成多副本。

---

## 二、Turn Loop：一个 while，三种收尾

`apps/zcode-cli/packages/core/src/runtime/methods/turn-loop.ts`：

- `runRegularTurnLoop()` 是 `while(true)`：
  1. 检查 abort；
  2. 取当前可用工具（`getTurnTools` / tool visibility）；
  3. `runModelBackedTurnStep()` 发模型请求；
  4. 有 tool_call 就执行一批，把结果回填；
  5. 没有 tool_call 就结束；
  6. 每轮检查 compact 触发条件、goal reminder、pending input、output-token continuation。
- 工具有独立的执行/结算层：`turn-tools.ts`、`tool-result-settlement.ts`、`turn-tool-warnings.ts`、`streaming-tool-synthetic-result.ts`。
- 输出被截断时不是直接失败：`turn-output-token-continuation.ts` 最多续写 3 次，prompt 明确要求“从断点继续，不要道歉/复述”。
- 连续 compact 过快有 `MAX_CONSECUTIVE_RAPID_REFILLS` 保护，避免“压缩→立刻又满→再压缩”的死循环。

TriBot 的 `engine/index.ts` 结构类似（for step < maxSteps），但没有：
- 输出截断续写；
- compact 后的 rapid-refill 保护；
- 工具结果结算/媒体持久化/警告分类；
- 显式的 turn 状态机。

---

## 三、上下文管理：三层压缩

ZCode 不是“超了才 summarize”，而是三层：

| 层 | 文件 | 作用 |
|---|---|---|
| Microcompact | `microcompact.ts` | 每轮本地裁剪旧的工具输出/大块内容，不调用模型 |
| Auto compact | `compact.ts` | 接近窗口阈值时用模型生成摘要，保留最近消息 |
| Manual compact | `compact-active.ts` | 用户显式触发，可带自定义指令 |

配套：
- `context-usage.ts` / `context-cache-hit-rate`：把 cache hit、上下文占比做成状态；
- `projection-anchor.ts`：压缩后给 UI 一个稳定锚点，避免消息列表跳动；
- `compact-media-capability-projection.ts`：图片/附件按模型能力裁剪。

TriBot 目前只有手动 compact + 一个上下文洞察抽屉，没有自动阈值和 microcompact。**这是低成本高收益的一项**。

---

## 四、工具系统：契约、权限、搜索

ZCode 的工具不是“函数数组”，而是带完整元数据的契约：

```ts
interface ToolEntry {
  capability: string;
  metadata: {
    name; description; readOnly; destructive; concurrentSafe;
    timeoutMs; maxOutputBytes; sideEffectScope; riskLevel; needsApproval;
  };
  inputSchema; outputSchema;
  runtimeInputSchema; runtimeOutputSchema;
  handler;
}
```

- 契约在 `apps/zcode-cli/packages/contracts/src/tools/*`，用 zod 定义 + `toToolJsonSchema` 生成给模型的 schema；
- 执行层在 `core/src/tool/handlers/`，按 `guarded/` 分组；
- 权限：`bash-command-permission-policy.ts` + 十几层 `bash-readonly-policy-*`，把命令解析成 argv 再判定，不靠字符串黑名单；
- 工具搜索：`ToolSearch` 让模型按需加载工具定义，避免一次性塞几百个 schema；`tool-search.ts` 有 native/local/off 模式；
- 结果结算：`tool-result-settlement.ts` 统一处理错误、取消、媒体附件、token 用量、stderr。

TriBot 只有 13 个工具，暂时不需要 ToolSearch；但 **MCP 一多，schema 会爆炸**。建议预留“工具分组/按需加载”，而不是现在把 MCP 全量塞给模型。

---

## 五、权限：模式 + 规则 + 审批

ZCode 的权限不是单一 sandbox，而是：

- 会话模式：`plan / build / edit / yolo / guarded / auto`（`contracts/src/tools/plan-mode.ts`）；
- 命令规则：只读命令白名单、git 子命令、管道/重定向、cwd 逃逸、gh rate limit 等分别判定；
- 审批：`PermissionService` + `inheritPermissionMode`，子代理继承父级权限并可被收紧；
- 计划模式：`EnterPlanMode` / `ExitPlanMode`，退出时把 allowedPrompts 带回。

TriBot 的 `read_only / workspace / full` 三档更简单，已经够用；值得补的是：
- **子代理不能比父代理权限更大**；
- 命令按 argv 判定，而不是只按风险字符串；
- 计划模式的“批准后只放行计划里列出的命令”。

---

## 六、子代理与工作流：ZCode 最重的部分

### 子代理

- 工具：`Agent`（`contracts/src/tools/agent.ts`），参数含 `description / prompt / subagent_type / run_in_background`；
- 类型：`general-purpose`、`Explore`（只读探索专用 profile）；
- 运行时：`runtime/methods/subagent.ts` 为子代理创建独立 `AgentRuntime`，继承/裁剪工具、借用 MCP、独立模型选择、持久记忆、超时策略；
- 通信：`respond-to-coordinator.ts` + `submit-result.ts`，子代理用结构化 JSON 交结果，不是把自然语言塞回父上下文；
- 后台：`run_in_background` 完成后唤醒父级，`agent-background-subagent-join.md` 定义了 join 语义。

### 工作流

- 契约：`workflow.ts` / `create-workflow.ts` / `save-workflow.ts` / `resume-workflow-run.ts`；
- 运行：`dynamic-workflow-run-*`、`workflow-run-track.ts`、`workflow-run-roster.ts`；
- 支持“洞”（hole）让子代理填、`eval-workflow-snippet`、`fill-workflow-hole`、`get-workflow-run-roster`；
- UI 有 `ConversationStatusPanel` 展示 workflow phase / roster / 进度。

TriBot 的 `assign` 只是把任务丢给另一个 Bot，结果是自然语言字符串，没有隔离上下文、结构化结果、后台 join。**这是 TriBot 从“Bot 团队”升级到“可编排代理”的关键缺口。**

---

## 七、目标、检查点、回溯：最值得抄的三个能力

### Goal

- `SessionGoal` + `goal-state-reminder.ts`：目标状态变化以 system reminder 注入，不污染对话；
- `target-continuation-loop.ts`：目标未完成时自动继续下一轮；
- `target-completion-verification.ts`：用一个独立模型调用验证“目标是否真的完成”，避免模型自说自话。

TriBot 没有 goal；用户说“继续”才继续。这就是为什么会出现“做到一半停了/达到轮次上限”的体感。

### Checkpoint / Rewind / Fork

- `workspace-checkpoints.ts`：在工具写文件前记录 workspace artifact；
- `rewind.ts`：按消息/检查点回滚文件；
- `workspace-fork.ts` / `session-fork.ts`：从某条消息分叉新会话，复制 goal 状态；
- UI 侧有 diff/checkpoint 入口。

TriBot 的 `write_file` 是直接覆盖，没有 undo。用户改论文/代码时这是高风险缺口。

### 目标验证

`target-completion-verification.ts` 会单独发一个“验收”请求，解析结构化输出；失败则 fail-open，不阻塞主流程。这个模式可以直接搬到 TriBot 的“任务完成前自检”。

---

## 八、UI：状态面板 + 侧栏，而不是把所有东西塞进聊天流

ZCode 的聊天页是：

- 中间：消息流 + composer + 队列；
- 右侧：`ConversationStatusPanel`，分区展示 Plan / Todo / BackgroundWork / Subagents / Workflow / Git；
- 再右侧/可切换：`AnimatedSidePanePanel`，tab 化 Browser / Git / Files / Terminal / Whiteboard / ModelTrajectory；
- 状态面板是**投影**，不是第二份状态；TodoPanel 只读，完成状态来自 runtime。

TriBot 刚加的右侧清单是正确方向，但目前只有 todo，且状态在 localStorage。下一步应该把它升级成 **StatusPanel**：
- Todo（已有）
- 本轮改了哪些文件（diff）
- 后台任务
- 子代理
- 目标/验收

---

## 九、远程与多端

- 每个窗口一个 Host；手机通过 attachment 挂到已有 Host，不另起 Agent；
- `remoteSessionId` 与 `workspaceKey` 分离；
- continuous / replayable 两条链路，gap 用 snapshot 恢复；
- 远程断连 fail-closed，不静默回落本地。

TriBot 目前只有本地单机；这块暂时不用抄，但 **workspaceIdentity vs workspacePath** 的区分值得先做，否则以后接远程会重构。

---

## 十、工程化：强项与致命伤

### 强项

- zod 契约 + 运行时校验，协议不靠 `as`；
- RPC 传输抽象，桌面/Web/SSH 共用；
- `docs/architecture` 是当前事实入口，ADR/spec 齐全；
- i18n 中英 key 对齐（2,741 对）；
- 测试 id 契约、E2E、架构检查、knip、pre-push。

### 致命伤（仓库自己的审计文档 `docs/ZCode 项目架构分析与改进建议.md`）

- 近 90 天 4,044 个非 merge commit，**2,236 个是 fix（55%）**，fix:feat ≈ 3.7:1；
- 同一文件 7 天内被 fix 50–90 次；
- **模型选择一份状态有 6 个来源、69 个文件持有**；
- 任务列表 4 套并行结构；
- `useTaskStreamEvents` 一个 effect 42 个依赖，重订阅丢事件；
- 生产代码约 720 个 catch，大量“warn + 默认值”把 bug 变成状态撕裂；
- CI 的 lint/typecheck/unit job 曾被设为 `when: never`，e2e 不在 CI。

**这不是“ZCode 不行”，而是“规模 + 多副本状态 + 隐式状态机”的必然结果。** TriBot 现在小，正好避免。

---

## 十一、TriBot 对照表

| 能力 | ZCode | TriBot 现状 | 建议 |
|---|---|---|---|
| 会话状态所有权 | CLI 权威 + projection | renderer 直接持有 | P0 抽 reducer，别再加第二份 |
| Turn loop | 完整状态机 + 续写 + rapid-refill | for 循环 + maxSteps | P1 补续写/压缩保护 |
| 上下文压缩 | micro/auto/manual 三层 | 手动 compact | P0 自动阈值 + 工具输出裁剪 |
| 工具契约 | zod + 元数据 + 结果结算 | TS 接口 + 手写参数 | P1 加元数据/输出预算 |
| 工具搜索 | ToolSearch | 无 | P2（MCP 多时） |
| 权限 | 模式 + argv 规则 + 审批 | 三档 sandbox | P1 子代理权限继承 |
| 子代理 | 独立 runtime + 结构化结果 + 后台 | assign 自然语言 | P1 结构化 + 隔离 |
| 目标/继续 | Goal + 完成验证 | 无 | **P0** |
| 检查点/回滚 | checkpoint + rewind + fork | 无 | **P0** |
| 后台任务 | background bash + 通知 | 同步 run_command | P1 |
| 状态面板 | Plan/Todo/Bg/Subagent/Git | 只有 Todo | P0 扩展 |
| 工作流 | 创建/保存/恢复/roster | 无 | P2 |
| 远程/多端 | Host + attachment | 单机 | P3 |
| 工程治理 | 强契约，但规模失控 | 小、测试 161 | 保持小 |

---

## 十二、值得抄的 8 个模式

1. **单一事实源 + projection**：UI 不直接改业务状态。
2. **显式 turn 状态机**：不要用闭包布尔旗。
3. **工具结果统一结算**：错误/取消/媒体/token 一处处理。
4. **输出截断续写**：max_tokens 不是失败。
5. **三层压缩**：micro 先裁剪，auto 再摘要，manual 兜底。
6. **Goal + 独立验收**：完成不是模型说了算。
7. **写前 checkpoint**：任何写文件都可回滚。
8. **子代理结构化结果**：`submit_result` 而不是自然语言回传。

## 十三、不要抄的 6 个坑

1. 把 UI 做成第二份权威状态（6 个模型来源）。
2. 一个 effect 几十个依赖，重订阅补 seq。
3. 用 `catch { warn; return 默认值 }` 吞掉同步失败。
4. 巨型单文件（7,000 行 service、4,000 行 adapter）。
5. 先加功能、后补测试；CI 门禁形同虚设。
6. 用“兜底注释”代替根因修复。

---

## 十四、建议路线（按 TriBot 现状）

### P0（1–2 周，直接提升体验）

1. **会话 reducer**：把 `App.tsx` 的 messages/streams/queue/todos 收进一个 `useSessionState` reducer；事件按 `(sessionId, seq)` 归并。先做，后面所有功能都受益。
2. **写前 checkpoint + 一键回滚**：`write_file`/`run_command` 前记录文件快照；右侧面板显示“本轮改动”，支持撤销。
3. **Goal + 自动继续 + 轻量验收**：会话级 goal，未完成时继续；完成前发一次验收请求。
4. **自动上下文压缩**：80% 阈值触发；先裁剪旧 tool_result，再摘要。
5. **StatusPanel 扩展**：Todo（已有）+ 改动文件 + 后台任务 + 子代理。

### P1（2–4 周）

6. 子代理结构化：`assign` 返回 JSON + 独立上下文 + 权限继承。
7. 后台命令：`run_command` 支持 background，任务列表可停止/看输出。
8. Diff 面板：文件改动可视化，和 checkpoint 联动。
9. 工具元数据 + 输出预算：大输出自动落盘/压缩。
10. 计划模式批准后只放行计划内命令。

### P2（有明确需求再做）

11. ToolSearch（MCP 工具超过 ~30 个时）。
12. 会话 fork/rewind UI。
13. 工作流（保存/恢复/roster）。
14. 远程/手机 attachment。
15. 插件市场。

---

## 十五、一句话总结

ZCode 的 **runtime、工具契约、压缩、goal/checkpoint、状态面板** 是成熟设计；
它的 **前端多副本状态、巨型文件、吞异常、门禁失效** 是反面教材。
TriBot 应该学第一组，避开第二组——保持现在的小体量，先把“状态收敛 + 可回滚 + 目标闭环”做掉，再谈子代理和工作流。
