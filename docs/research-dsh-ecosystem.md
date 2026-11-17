# DSH（DeepSeek Harness）插件生态调研简报

> 🔍 TriBot · 研究员 产出 · 完成时间：2026-10-29（Asia/Shanghai）
> 数据基准：本机官方插件市场缓存快照，生成于 **2026-10-27T23:07:01Z**（`schemaVersion=2`）

## 一、结论

DSH 插件生态处于**爆发式增长早期**：市场索引已收录 15,748 个条目（cordis-plugin 15,460 + skill 288），2026 年 10 月单月新增更新 9,738 条、近 7 天活跃 5,195 条（33%），但星数高度长尾（中位数为 0，破千星仅 57 个）。头部由「多智能体框架、免费模型接入、桌面客户端、记忆系统、awesome 精选清单」五类占据。

## 二、方法与检索交代（重要）

**联网检索 9 次尝试全部失败，0 条远程来源入库**，原因（均已实测留痕）：

| 通道 | 结果 |
|---|---|
| `web_search` / `x_search` / `read_page` | modsearch 桥损坏：`D:\lora-bundle\dsh-plugins\modsearch\dist\main.js` 不存在（`D:\lora-bundle` 目录存在，文件缺失） |
| `web_fetch` | 本机注册了两个可用 provider（deepseek-fetch-api、http），未指定其一，调用被拒 |
| shell 直连 GitHub API | TLS 握手失败（curl exit 35，强制 TLS 1.2 无效） |
| shell 经系统代理 127.0.0.1:7890 | 代理进程未运行（curl exit 7） |

因此本简报全部结论基于**本地一手 A 级来源**（见第八节），共采信 **3 个来源**；另缓存内含 2,566 条插件主页链接（16.3%）**均未联网复核**。本地分析共 3 轮 + 联网失败尝试 9 次，合计 12 轮。

**有效来源（3 个，均为 A 级一手）**：
1. 官方市场缓存 `plugins-cache.json`（15,748 条全量快照，含星数/标签/更新时间/评分/安装方式）
2. 本机 `.dsh` 安装实况（`plugins\dsh-market\`、`skills\tribot\`）
3. modsearch 插件半安装损坏现场（生态健康度反例证据）

## 三、主流插件类别

市场采用**中英文标签体系**（单插件约 10–14 个标签）。剔除 `dsh-plugin`(14,555)、`deepseek-harness`(11,168)、`dsh`(8,881)、`cordis`(2,269) 等元标签后，功能标签词频 Top 18 如下（来源：缓存全量统计）：

| 类别簇 | 代表标签（词频） | 典型插件 |
|---|---|---|
| 工具集成/效率 | 效率提升(7,042)、工具集成(4,604)、快捷操作(2,249)、命令行工具(1,251) | dsh-toolkit（零依赖十合一工具） |
| UI/前端增强 | 可视化(2,505)、前端增强(2,449)、设置面板(1,702)、主题(1,560) | dsh-yorha-ui、dsh-theme、dsh-sidebar-image-zoom |
| 会话/工作区管理 | 会话管理(3,380)、状态持久化(1,441)、工作区管理(1,389) | dsh-claude-move（四源迁移向导）、dsh-session-workspace |
| 状态监控 | 状态监控(3,220) | dsh-balance-panel、dsh-openrouter-monitor、dsh-usage-widget |
| 模型接入/适配 | 模型适配(1,704) | dsh-our-free-model（免密钥用前沿模型） |
| 记忆与知识 | （散见于描述） | MemOS（持久记忆）、dsh-memory-center、dsh-mnemon |
| 工作流增强 | 工作流增强(2,543) | dsh-deepresearch、dsh-routing-suite |
| 插件生态自身 | 插件管理(2,427) | dsh-market（市场本体）、dsh-plugin-update、dsh-plugin-trust-audit |
| 安全/审批 | 安全审查(1,301) | dsh-approval-ai-review、dsh-lock、dsh-memory-gate |

另有独立的 **Skills 生态**（288 个，`skills-add` 安装）：多智能体编排（ruflo）、思维提炼（distilly）、技能商店（anbeime/skill）等。

## 四、头部插件（按 GitHub 星数 Top 15）

⚠️ 口径说明：市场按 GitHub topic 爬虫收录，部分头部条目是**挂了 DSH 相关 topic 的大型通用项目**（星数归属其原仓库），榜单应理解为「DSH 生态相关热门仓库」。

| 排名 | 仓库 | 星数 | 类型 | 一句话简介（缓存中文描述摘录） |
|---|---|---|---|---|
| 1 | ruvnet/ruflo | 79,774 | skill | 部署多智能体集群，协调自主工作流 |
| 2 | Ebony-Vinyl/dsh-our-free-model | 46,733 | 插件 | 免登录免密钥直用 DeepSeek V4.1 Flash、Kimi K3 等 |
| 3 | Tencent/WeKnora | 35,656 | 插件 | 文档转 RAG 知识库，自动推理维护 Wiki |
| 4 | anywhere-labs/dsh-desktop | 33,363 | 插件 | 免配置启动本地 Harness，图形化管理插件 |
| 5 | titanwings/distilly | 26,106 | skill | 把专家思考方式提炼成可复用技能 |
| 6 | awesome-dsh-plugin/awesome-dsh-plugin | 21,117 | 插件 | 官方之外的插件精选清单 |
| 7 | dataelement/dsh-desktop | 17,144 | 插件 | 本地优先跨平台桌面客户端 |
| 8 | MemTensor/MemOS | 12,132 | 插件 | 大模型持久记忆操作系统 |
| 9 | YuJunZhiXue/dsh-purge | 11,034 | 插件 | 模型「破甲」解锁、按模型换提示词（见第六节风险） |
| 10 | Tencent/BrowserSkill | 9,684 | 插件 | AI 直接操控已登录浏览器 |
| 11 | zhu1090093659/dsh-web | 9,667 | 插件 | Web 端插件套装（任务看板/SSH/Git 可视化） |
| 12 | dsh-market/dsh-market | 9,316 | 插件 | DSH 内置插件市场本体 |
| 13 | anbeime/skill | 8,767 | skill | 一站式技能商店，聚合 GitHub 热门 Skills |
| 14 | yjh051108/dsh-routing-suite | 7,003 | 插件 | 路由套件 |
| 15 | superdesigndev/treg | 6,384 | 插件 | — |

 Cordis 插件的头部（剔除 skill 后）：dsh-our-free-model → WeKnora → dsh-desktop → awesome-dsh-plugin → dsh-desktop(dataelement) → MemOS。

## 五、社区活跃度

- **总量**：15,748 条收录（cordis-plugin 15,460 / skill 288），全部带 `pushedAt` 更新时间。
- **更新速度（爆发期特征）**：近 7 天 5,195 条（33.0%）、近 14 天 7,502 条（47.6%）、近 30 天 10,627 条（67.5%）、近 60 天 14,297 条（90.8%）。月度节奏：2026-08：1,886 → 09：4,122 → **10：9,738**，逐月翻倍级增长。
- **星数长尾**：中位数 **0**；>0 星 7,659 个；>10 星 1,309 个；>100 星 296 个；>1,000 星仅 57 个。
- **命名规约**：85.0%（13,389 个）以 `dsh-` 前缀命名，社区约定高度统一。
- **收录渠道**：topic 爬虫 15,282；awesome-0xsline 清单 621；awesome-alex 清单 73；**issue-submission 官方受理社区投稿 35**（缓存中另有 14+10 条与上述渠道交叉）。
- **官方运营程度（早期信号）**：所有 15,748 条 `curated=False`——尚无官方精选标记；但市场自带质量评分：15,409 条有评分，≥80 分仅 574 条、≥60 分 3,124 条、最高 96 分；**339 条被标记 `risky`**（如 baro 子代理、mcp-lens 网关、memory-gate 等）。
- **主页覆盖**：仅 16.3%（2,566 条）有独立主页，多数插件只有 GitHub 仓库。

## 六、风险与争议点

1. **「破甲」类插件被高星收录**：dsh-purge（11,034 星）宣传解锁全部模型、替换系统提示词，与 339 条 risky 标记同现——市场审核宽严并存，`risky` 标记体系已启动但 curated 精选机制缺席。
2. **生态基础设施健康度**：研究员本机的 modsearch 联网桥处于半安装损坏状态（注册目录存在、`dist/main.js` 缺失），直接瘫痪全部联网工具——第三方插件安装/升级链路存在可靠性风险。
3. **榜单口径污染**：topic 爬虫把星数极高但非插件本体的大型仓库（WeKnora、MemOS）计入榜单，「头部插件」与「DSH 相关热门仓库」存在口径差异（已在第四节标注）。

## 七、冲突与不确定

- **冲突**：无（本次仅单一来源维度，不存在可互证的多源分歧）。
- **不确定**：
  - 全部数据来自 2026-10-27 本机缓存快照，非实时；未能联网复核任何 homepage 链接与星数现值（标注：未核验）。
  - 星数为仓库级数据，不等同于插件在 DSH 用户中的实际安装量；市场未披露下载量/安装量字段。
  - 8 月以前的月度数据稀疏（2026-01 与 06 各 1 条），生态起点时间无法精确判断。

## 八、来源清单

**采信来源（3 个，A 级一手，均为本机文件）**：
1. `C:\Users\admin\.dsh\plugins\dsh-market\plugins-cache.json` —— 官方市场全量缓存（generatedAt 2026-10-27T23:07:01.819Z，15,748 条；本简报所有数字出处）
2. `C:\Users\admin\.dsh\plugins\` 与 `C:\Users\admin\.dsh\skills\` —— 本机安装实况（dsh-market 缓存 + tribot 技能）
3. `D:\lora-bundle\dsh-plugins\modsearch\dist\main.js` 缺失现场 —— 联网桥损坏证据

**缓存内登记、未联网复核的生态入口（C 级，仅供参考）**：
- 插件精选清单：https://awesome-dsh-plugin.com
- 插件市场主页：https://dshmarket.com ；Web 端插件套装：https://dsh-market.com
- 桌面客户端：https://dshdesktop.cn 、https://dshdesktop.com
- 记忆系统 MemOS：https://memos.openmem.net ；WeKnora：https://weknora.weixin.qq.com
- 迁移插件示例页：https://perrylink.github.io/plugins/dsh-claude-move/

---
*简报完。检索轮次合计 12（联网失败尝试 9 + 本地分析 3）；采信来源 3 个；未联网复核链接 2,566 条。*
