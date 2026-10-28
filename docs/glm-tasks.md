# 可以交给 GLM 干的活（任务卡）

> 用法：设置 → 模型与凭证 → 选「智谱 GLM」→ 填 Key → 拉取模型 → 勾选 GLM-5.3 / 5.2；
> 回到对话，输入框选「工程师」Bot、模型选 GLM-5.3、打开「计划」，把下面任意一张卡整段贴进去。
> 每张卡都按 assign 五要素写：目标 / 输入 / 交付物 / 验收 / 禁区。

## 卡 1：再加两套皮肤预设（最安全，纯前端）

**目标**：在现有 4 套皮肤预设基础上，新增「晨雾」和「铜绿」两套渐变预设。

**输入**：
- 预设定义在 `packages/shared/src/index.ts` 的 `SKIN_PRESETS`
- 设置页渲染在 `packages/app/renderer/src/panels.tsx` 的「皮肤」区块
- 现有 4 套：暮色 / 余烬 / 深青 / 石墨

**交付物**：
- `SKIN_PRESETS` 增加 2 项，`id` 为 `mist`、`patina`，label 为「晨雾」「铜绿」
- 渐变色偏中性（参考现有写法，不要紫蓝渐变），能在深色和浅色主题下都不刺眼

**验收**：
- 设置 → 通用 → 皮肤出现 6 个色块 + 「无」
- 点任意新预设能立即生效，刷新后仍保持（需要点「保存设置」）
- `pnpm --filter @tribot/app exec tsc --noEmit -p tsconfig.renderer.json` 通过
- `pnpm --filter @tribot/app exec vite build -c renderer/vite.config.ts` 通过

**禁区**：不要改皮肤上传逻辑、不要动服务端 `/api/skin`。

---

## 卡 2：技能库加搜索框

**目标**：技能页面顶部加一个搜索框，按名称/描述实时过滤。

**输入**：
- 技能面板在 `packages/app/renderer/src/panels.tsx` 的 `SkillsPanel`
- 数据结构参考 `SkillMeta`（`packages/shared/src/index.ts`）

**交付物**：
- 搜索框（placeholder：搜索技能名 / 描述）
- 过滤逻辑：名称或描述包含关键词（不区分大小写）
- 空结果时显示「没有匹配的技能」

**验收**：
- 输入关键词技能列表实时变化；清空恢复全部
- 不影响原有「扫描目录 / 启用停用」按钮
- 渲染层 typecheck 通过

**禁区**：不要改 `scanSkills` 的服务端逻辑，不要动技能文件。

---

## 卡 3：定时任务显示「下次运行时间」

**目标**：定时任务卡片上显示下一次触发时间，让人知道它什么时候会跑。

**输入**：
- 定时任务面板在 `packages/app/renderer/src/panels.tsx` 的 `RoutinesPanel`
- 依赖已安装：`cron-parser`（服务端在用）
- 前端可以直接用 `cron-parser` 的 `parseExpression(...).next().toDate()`，注意传本地时区

**交付物**：
- 卡片信息区增加「下次：MM-DD HH:mm」
- cron 非法时显示「cron 无效」而不是崩溃

**验收**：
- 新建 `0 9 * * *` 的任务，卡片显示明天 09:00
- 新建 `0 3 * * *` 且勾选低谷，卡片同时显示「低谷」标记
- typecheck 通过

**禁区**：不要改调度器执行逻辑（`packages/core/src/routines/scheduler.ts`）。

---

## 不适合直接交给 GLM 的

- 数据库迁移、权限/加密、打包签名：出错代价高，必须人审
- 多窗口架构、MCP 协议接入：跨模块设计，容易改一半
- 任何需要真实 API Key 才能验证的（拉模型、真实对话）——可以先写代码，但验收要你自己跑
