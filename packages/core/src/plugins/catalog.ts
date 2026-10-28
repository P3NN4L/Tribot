import type { PluginCategory } from '@tribot/shared';

// ===== 内置插件目录 =====
// 插件 = 一个符合开放 SKILL.md 格式的技能包；安装后落到 data/skills/<id>/SKILL.md，
// 立即出现在「技能库」并被所有 Bot 通过 use_skill 调用。

export interface PluginSeed {
  id: string;
  name: string;
  author: string;
  version: string;
  category: PluginCategory;
  description: string;
  tags: string[];
  highlights: string[];
  installs: number;
  skill: { name: string; description: string; body: string };
}

export const PLUGIN_CATALOG: PluginSeed[] = [
  {
    id: 'deep-research',
    name: '深度调研',
    author: 'TriBot 官方',
    version: '1.2.0',
    category: 'research',
    description: '把一个模糊问题拆成可验证的子问题，多源检索后给出带引用的简报。',
    tags: ['调研', '引用', '多源'],
    highlights: ['先列子问题再检索', '每个结论必须有来源', '区分事实 / 推断 / 传闻'],
    installs: 1284,
    skill: {
      name: '深度调研',
      description: '多源检索 + 交叉验证，输出带引用的调研简报。',
      body: `## 何时用
用户要「调研 / 对比 / 摸清某件事」时。

## 步骤
1. 把问题拆成 3-5 个可验证子问题，先列出来再动手。
2. 每个子问题至少检索 2 个独立来源；优先官方文档/一手资料。
3. 交叉验证：两个来源冲突时，标注冲突而不是二选一。
4. 输出结构：结论（3 条以内）→ 证据表格（来源 URL + 关键原文）→ 风险与不确定性。

## 质量线
- 没有来源的断言必须标「未证实」。
- 不把博客转述当成官方事实。
- 最后给一句：如果只能做一件事，建议做什么。`,
    },
  },
  {
    id: 'source-check',
    name: '信源核验',
    author: 'community / veritas',
    version: '0.9.3',
    category: 'research',
    description: '对一段说法做事实核查：找原始出处、看时间线、识别被二次加工的结论。',
    tags: ['核查', '溯源', '反谣言'],
    highlights: ['追到最早出处', '检查数字是否被截断', '给出可信度评分'],
    installs: 642,
    skill: {
      name: '信源核验',
      description: '给说法打可信度分，并追到最早出处。',
      body: `## 步骤
1. 把待核查说法压缩成一句可判真伪的命题。
2. 找最早出处（论文/官方公告/原始帖），而不是转载。
3. 检查三类常见失真：数字截断、时间错位、主语替换。
4. 输出：命题 → 判定（真/假/部分真/无法判定）→ 关键证据 → 可信度 0-100。

## 纪律
- 找不到原始出处时，直接说「无法回溯」，不要用二手来源硬撑。
- 不要因为「很多人都这么说」就提高可信度。`,
    },
  },
  {
    id: 'doc-writer',
    name: '长文写作',
    author: 'TriBot 官方',
    version: '1.1.0',
    category: 'writing',
    description: '从提纲到成稿的中文长文写作流程，控制结构、节奏与口水词。',
    tags: ['写作', '长文', '结构'],
    highlights: ['先给提纲等确认', '一段一个论点', '自动清理 AI 腔'],
    installs: 903,
    skill: {
      name: '长文写作',
      description: '提纲 → 草稿 → 去 AI 腔的写作流程。',
      body: `## 流程
1. 先输出 5-8 条提纲（每条形如「论点 + 支撑材料」），等用户确认再写正文。
2. 正文一段只讲一个论点；每段首句就是结论。
3. 例子优先用具体的数字、时间、人名，不用「很多人」「众所周知」。
4. 完稿后自检并列出修改：删掉空话、拆开长句、统一术语。

## 禁止
- 不用「首先/其次/最后」凑结构。
- 不写「综上所述」「值得注意的是」这类填充句。
- 不堆四字词。`,
    },
  },
  {
    id: 'release-notes',
    name: '发版说明',
    author: 'community / shipit',
    version: '1.0.4',
    category: 'writing',
    description: '把一堆 commit / PR 变成人话版 release notes，自动分类并标破坏性变更。',
    tags: ['发版', 'changelog'],
    highlights: ['按影响面分类', '自动标 BREAKING', '面向用户而非提交者'],
    installs: 511,
    skill: {
      name: '发版说明',
      description: '把 commit 列表整理成用户能读懂的 release notes。',
      body: `## 步骤
1. 拉取 commit / PR 列表，过滤掉 chore、format、typo。
2. 分类：新功能 / 改进 / 修复 / 破坏性变更 / 安全。
3. 每条改写成人话：做了什么 → 对用户有什么影响 → 需要做什么迁移。
4. 破坏性变更置顶，并给迁移示例代码。

## 输出模板
## vX.Y.Z
### 破坏性变更
### 新功能
### 修复
### 升级建议`,
    },
  },
  {
    id: 'code-review',
    name: '代码审查',
    author: 'TriBot 官方',
    version: '1.3.1',
    category: 'engineering',
    description: '按风险而非风格做 review：并发、边界、错误处理、性能、安全。',
    tags: ['review', '质量', '安全'],
    highlights: ['只报会影响正确性的问题', '每条给最小修复', '区分阻塞 / 建议'],
    installs: 1567,
    skill: {
      name: '代码审查',
      description: '以风险为优先级的 code review 清单。',
      body: `## 审查顺序（按风险）
1. 正确性：边界条件、空值、并发/竞态、幂等。
2. 错误处理：异常是否被吞、超时与重试是否死循环。
3. 安全：注入、路径穿越、密钥硬编码、越权。
4. 性能：N+1、无界内存增长、阻塞调用。
5. 最后才看命名与风格。

## 输出
- 每条：位置 → 问题 → 影响 → 最小修复（代码级）。
- 标注 [阻塞] / [建议]，阻塞项不超过 5 条。
- 不要重写整个文件，只给 diff 片段。`,
    },
  },
  {
    id: 'repo-explainer',
    name: '仓库导读',
    author: 'community / onboarding',
    version: '1.0.2',
    category: 'engineering',
    description: '新仓库快速摸底：跑起来、找到主链路、画出模块依赖。',
    tags: ['上手', '架构', '文档'],
    highlights: ['先跑通再读代码', '定位唯一主链路', '输出一页纸导读'],
    installs: 738,
    skill: {
      name: '仓库导读',
      description: '把陌生仓库压缩成一页纸的导读。',
      body: `## 步骤
1. 读 README / package.json / 构建脚本，写出「怎么跑起来」。
2. 找入口文件，顺着主链路读一遍，记录关键函数与数据流。
3. 画出模块依赖（文字版即可：A → B → C）。
4. 输出一页纸：这是什么 / 怎么跑 / 主链路 / 三个容易踩的坑 / 建议先读的 5 个文件。

## 纪律
- 不要贴大段源码，给路径 + 一句话作用。
- 没验证过的猜测要标「待确认」。`,
    },
  },
  {
    id: 'data-brief',
    name: '数据速读',
    author: 'community / numbers',
    version: '0.8.7',
    category: 'data',
    description: '拿到 CSV / 表格先做体检，再给三条能行动的结论，而不是描述性统计堆砌。',
    tags: ['数据', '分析', '结论'],
    highlights: ['先查缺失与异常', '结论必须可行动', '给出口径与假设'],
    installs: 455,
    skill: {
      name: '数据速读',
      description: '数据体检 + 三条可行动结论。',
      body: `## 流程
1. 体检：行数、字段类型、缺失率、重复、异常值、时间范围。
2. 找分布与相关，但先声明口径（分母是谁、时间窗多大）。
3. 输出三条结论，每条必须是「所以可以做什么」。
4. 附一段：这份数据不能回答什么问题。

## 禁止
- 不把相关系数说成因果。
- 不用均值描述长尾分布。
- 不省略样本量。`,
    },
  },
  {
    id: 'ops-runbook',
    name: '运维手册',
    author: 'community / sre',
    version: '1.1.6',
    category: 'ops',
    description: '把一次线上故障整理成可复用的 runbook：现象、定位、止血、根因、预防。',
    tags: ['运维', '故障', 'SOP'],
    highlights: ['止血优先于根因', '每步带验证命令', '沉淀成可执行清单'],
    installs: 389,
    skill: {
      name: '运维手册',
      description: '故障处理与 runbook 沉淀。',
      body: `## 处理顺序
1. 止血（回滚 / 限流 / 摘流量）优先，别急着找根因。
2. 每一步给：命令 → 预期输出 → 失败时的下一步。
3. 记录时间线（几点做了什么、指标怎么变）。
4. 事后：根因 → 为什么没提前发现 → 一条能落地的预防措施。

## 输出
- 现象 / 影响面 / 止血动作 / 根因 / 预防
- 所有命令必须能在本机直接复制执行。`,
    },
  },
  {
    id: 'pdf-reader',
    name: 'PDF 阅读',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'data',
    description: '读取 PDF 正文并做摘要、问答或表格抽取。',
    tags: ['PDF', '文档', '抽取'],
    highlights: ['调用 read_document 直接读正文', '长文先摘要再定位页码', '扫描件会提示无文字层'],
    installs: 0,
    skill: {
      name: 'PDF 阅读',
      description: '用 read_document 读取 PDF 文本，按需总结或抽取信息。',
      body: `## 何时用
用户给了一个 .pdf，要求总结、问答、抽取条款/表格时。

## 步骤
1. 用 read_document 工具，path 填工作区内的 PDF 相对路径。
2. 先看开头判断结构（目录/章节），再决定读全文还是只答局部。
3. 输出引用时标「第 N 页 / 章节名」，不要编页码。
4. 扫描件通常没有文字层：read_document 返回空时，明确告诉用户需要 OCR，不要瞎猜内容。

## 质量线
- 数字、日期、金额必须能在原文找到。
- 区分「原文没写」和「我没读到」。`,
    },
  },
  {
    id: 'docx-reader',
    name: 'Word 文档',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'writing',
    description: '读取 .docx 的段落与表格，做改写建议或摘要。',
    tags: ['Word', 'DOCX', '写作'],
    highlights: ['段落 + 表格一起读', '保留标题层级', '改写只给 diff'],
    installs: 0,
    skill: {
      name: 'Word 文档',
      description: '用 read_document 读 .docx，做摘要、审阅或改写。',
      body: `## 何时用
用户给了 .docx，要求总结、审阅、改写、提取表格时。

## 步骤
1. 用 read_document 读全文（段落与表格会按顺序输出）。
2. 总结时保留原有标题层级；表格单独列成 Markdown 表。
3. 改写只给「原文 → 建议」的 diff 片段，不重写整篇，除非用户明确要求。
4. 涉及数字/承诺/日期时回引原文。

## 质量线
- 不改用户原意，只改表达。
- 发现前后矛盾时单独列「疑点」，不要静默修掉。`,
    },
  },
  {
    id: 'xlsx-reader',
    name: '电子表格',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'data',
    description: '读取 .xlsx 各工作表，做数据速读、口径检查与异常定位。',
    tags: ['Excel', 'XLSX', '表格'],
    highlights: ['按 sheet 输出行数据', '先看表头与口径', '异常值单独标注'],
    installs: 0,
    skill: {
      name: '电子表格',
      description: '用 read_document 读 .xlsx，做速读、对比与异常检查。',
      body: `## 何时用
用户给了 .xlsx / .csv 数据表，要求速读、找异常、做对比时。

## 步骤
1. 用 read_document 读取，输出会按 sheet 分段，每行用 | 分隔。
2. 先确认表头、单位、时间范围，再算任何数。
3. 需要计算时把公式和中间结果写出来；不要只给结论。
4. 空值、重复、量级异常单独列「数据疑点」。

## 质量线
- 不把合计行当数据行。
- 百分比与绝对值不要混用。`,
    },
  },
  {
    id: 'pptx-reader',
    name: '演示文稿',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'writing',
    description: '读取 .pptx 每页文字，提炼结构并给改稿建议。',
    tags: ['PPT', 'PPTX', '汇报'],
    highlights: ['按 Slide 输出', '一页一个观点', '先结构后措辞'],
    installs: 0,
    skill: {
      name: '演示文稿',
      description: '用 read_document 读 .pptx，提炼结构并给修改建议。',
      body: `## 何时用
用户给了 .pptx，要求提炼大纲、检查逻辑或改稿时。

## 步骤
1. 用 read_document 读取，输出按 Slide 编号分段。
2. 先还原叙事线（问题 → 方案 → 证据 → 行动），再评价单页。
3. 每页只留一个观点；标题写成结论句，不写「背景介绍」。
4. 给建议时标清「第 N 页」。

## 质量线
- 不虚构图表里没有的数据。
- 页数与时长不匹配时直接指出。`,
    },
  },
  {
    id: 'skill-creator',
    name: '技能创建器',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '把一套流程固化成 SKILL.md，让所有 Bot 可复用。',
    tags: ['技能', 'SKILL.md', '复用'],
    highlights: ['标准 frontmatter', '何时用 / 步骤 / 质量线', '写入 data/skills'],
    installs: 0,
    skill: {
      name: '技能创建器',
      description: '引导创建可复用技能，输出规范 SKILL.md。',
      body: `## 何时用
用户说「把这套流程记下来 / 做成技能 / 以后都这么做」时。

## 步骤
1. 先确认：触发条件、输入、输出、失败时怎么办。
2. 用这个结构写 SKILL.md：
   ---
   name: 技能名
   description: 一句话说明何时用
   version: 1.0.0
   source: user/<id>
   ---
   ## 何时用
   ## 步骤（编号，可执行）
   ## 质量线（可检查）
   ## 输出格式
3. 写入 data/skills/<id>/SKILL.md（id 用小写短横线）。
4. 自查：换一个 Bot 只看这份文件，能不能照着做出来。

## 质量线
- 步骤必须可执行，不写「注意质量」这种空话。
- 一个技能只解决一类任务。`,
    },
  },
  {
    id: 'plugin-creator',
    name: '插件创建器',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '创建一个可安装的插件包（技能 + 元信息 + 市场条目）。',
    tags: ['插件', '市场', '开发'],
    highlights: ['插件就是技能包', '补齐市场元信息', '本地安装验证'],
    installs: 0,
    skill: {
      name: '插件创建器',
      description: '把技能包装成可安装插件，并写市场条目。',
      body: `## 何时用
用户要把一个技能发布成插件，或说「做一个插件」时。

## 步骤
1. 插件 = 一个技能目录（data/skills/<id>/SKILL.md）+ 市场元信息（名称、描述、分类、标签、亮点）。
2. 先写 SKILL.md，保证单独可用；元信息只是外壳。
3. 分类只能选：research / writing / engineering / data / ops。
4. 在插件市场安装一次，确认它出现在技能库并能被 use_skill 找到。

## 质量线
- 插件不依赖作者本机路径。
- 描述写「解决什么问题」，不写「基于 XX 技术」。`,
    },
  },
  {
    id: 'github-workflow',
    name: 'GitHub 工作流',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '用 git + GitHub REST 完成 issue、PR、review 与发布。',
    tags: ['GitHub', 'git', 'PR'],
    highlights: ['优先 git CLI', 'REST 走 http_fetch', 'token 从环境变量取'],
    installs: 0,
    skill: {
      name: 'GitHub 工作流',
      description: '基于 git 与 GitHub API 的仓库协作流程。',
      body: `## 何时用
要处理 GitHub 仓库的 issue / PR / review / release 时。

## 步骤
1. 先 \`git status\` / \`git log\` 确认本地状态，不要覆盖未提交改动。
2. 需要 API 时用 http_fetch，token 从环境变量 GITHUB_TOKEN 读取，不写进文件。
3. PR 描述写：改了什么、为什么、怎么验证；不贴大段 diff。
4. 发布前跑测试；失败就把失败输出贴出来，不静默重试。

## 质量线
- 不 force push 别人的分支。
- 不把 token 打进 commit。`,
    },
  },
  {
    id: 'gitlab-workflow',
    name: 'GitLab 工作流',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '用 git + GitLab API 处理 MR、pipeline 与 issue。',
    tags: ['GitLab', 'MR', 'CI'],
    highlights: ['MR 标题写结论', 'pipeline 失败先看日志', 'token 用 GITLAB_TOKEN'],
    installs: 0,
    skill: {
      name: 'GitLab 工作流',
      description: 'GitLab 仓库协作与 pipeline 排查。',
      body: `## 何时用
处理 GitLab 的 MR / pipeline / issue 时。

## 步骤
1. 先确认当前分支与远端：\`git branch -vv\`。
2. API 调用用 http_fetch，token 从 GITLAB_TOKEN 取。
3. pipeline 失败先拉失败 job 的日志，再判断是代码还是环境。
4. MR 描述包含：动机、改动面、回滚方式。

## 质量线
- 不直接推 main。
- 不隐藏失败用例。`,
    },
  },
  {
    id: 'jupyter-notebook',
    name: 'Jupyter Notebook',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'data',
    description: '读取/执行 .ipynb，做数据探索与结果复现。',
    tags: ['Jupyter', 'ipynb', '数据'],
    highlights: ['先检测 jupyter 是否安装', 'nbconvert 导出文本', '执行结果落文件'],
    installs: 0,
    skill: {
      name: 'Jupyter Notebook',
      description: '读取与执行 notebook，复现数据分析。',
      body: `## 何时用
用户给了 .ipynb，或要求做数据探索并保留 notebook 时。

## 步骤
1. 先 \`jupyter --version\` 检测；没装就告诉用户装 jupyter。
2. 读取内容：\`jupyter nbconvert --to script <file> --stdout\`，再按需执行。
3. 执行用 \`jupyter nbconvert --to notebook --execute --inplace\`，输出留在原 notebook。
4. 汇报时给：数据范围、关键结论、可复现命令。

## 质量线
- 不覆盖用户原始 notebook，先备份。
- 随机数固定 seed。`,
    },
  },
  {
    id: 'typst-docs',
    name: 'Typst 文档',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'writing',
    description: '用 Typst 写/编译排版文档与 PDF。',
    tags: ['Typst', '排版', 'PDF'],
    highlights: ['typst compile', '先检测 CLI', '错误定位到行'],
    installs: 0,
    skill: {
      name: 'Typst 文档',
      description: '编写并编译 Typst 文档。',
      body: `## 何时用
用户要排版文档、简历、报告，且接受 .typ 源文件时。

## 步骤
1. \`typst --version\` 检测；没装提示安装。
2. 写 .typ 源文件；标题/作者/日期放文档头部。
3. 编译：\`typst compile file.typ out.pdf\`；报错按行号修，不整篇重写。
4. 交付源文件 + PDF。

## 质量线
- 中文文档要确认字体可用。
- 编译警告也要看。`,
    },
  },
  {
    id: 'zotero-library',
    name: 'Zotero 文献库',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'research',
    description: '通过 Zotero 本地 API 检索条目、导出引用。',
    tags: ['Zotero', '文献', '引用'],
    highlights: ['本地 23119 端口', '先测连通', '引用格式按用户要求'],
    installs: 0,
    skill: {
      name: 'Zotero 文献库',
      description: '检索本地 Zotero 文库并整理引用。',
      body: `## 何时用
用户要查自己的 Zotero 文献、生成引用列表时。

## 步骤
1. Zotero 需开启「允许其他应用访问」；默认 http://127.0.0.1:23119。
2. 用 http_fetch 访问 /api/users/0/items?q=关键词，先小范围试。
3. 输出：标题、作者、年份、条目 key；引用格式按用户要求（GB/T 7714 / APA）。
4. 查不到时让用户确认 Zotero 是否在运行，不要编条目。

## 质量线
- 不伪造 DOI。
- 区分「库里有」和「网上能搜到」。`,
    },
  },
  {
    id: 'obsidian-vault',
    name: 'Obsidian 笔记库',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'writing',
    description: '读取/整理本地 Obsidian vault 的 Markdown 笔记。',
    tags: ['Obsidian', 'Markdown', '笔记'],
    highlights: ['read_file 直接读', '双链与标签保留', '写入前备份'],
    installs: 0,
    skill: {
      name: 'Obsidian 笔记库',
      description: '在本地 vault 中检索、整理、链接笔记。',
      body: `## 何时用
用户让整理 Obsidian 笔记、找双链、批量改标签时。

## 步骤
1. 先让用户给 vault 路径，或从任务工作区推断。
2. 检索用 list_dir + read_file；保留 [[双链]] 与 #标签 原样。
3. 批量修改前先备份到 .backup/ 或输出 diff。
4. 汇总成「改了什么 → 为什么」。

## 质量线
- 不动 .obsidian 配置。
- 不改用户措辞，除非明确要求。`,
    },
  },
  {
    id: 'aliyun-cli',
    name: '阿里云 CLI',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'ops',
    description: '用 aliyun CLI 查询/操作云资源。',
    tags: ['阿里云', 'CLI', '运维'],
    highlights: ['先 aliyun version', '只读优先', '危险操作要确认'],
    installs: 0,
    skill: {
      name: '阿里云 CLI',
      description: '通过 aliyun CLI 管理云资源。',
      body: `## 何时用
用户要查 ECS/OSS/SLS 等阿里云资源时。

## 步骤
1. \`aliyun version\` 检测；未配置凭证先让用户 \`aliyun configure\`。
2. 默认只读查询；删除/重启/改配置必须先向用户确认。
3. 命令写全 region 与资源 id，不靠默认值。
4. 输出资源 id、状态、计费方式。

## 质量线
- 不把 AccessKey 打在输出里。
- 破坏性操作给回滚方案。`,
    },
  },
  {
    id: 'cloudbase',
    name: '腾讯 CloudBase',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '用 CloudBase CLI 部署云函数与静态站点。',
    tags: ['CloudBase', '云开发', '部署'],
    highlights: ['tcb CLI', '环境 id 必填', '部署前看 diff'],
    installs: 0,
    skill: {
      name: '腾讯 CloudBase',
      description: 'CloudBase 云开发部署与排查。',
      body: `## 何时用
用户要部署云函数、静态托管、数据库时。

## 步骤
1. \`tcb --version\` 检测，未登录先 \`tcb login\`。
2. 确认 envId；不同环境不要混用。
3. 部署前说明会覆盖哪些函数/文件。
4. 失败先看 CLI 输出与云端日志。

## 质量线
- 不删生产环境资源。
- 密钥走环境变量。`,
    },
  },
  {
    id: 'feishu-cli',
    name: '飞书 CLI',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'ops',
    description: '飞书文档、表格、多维表、消息的 CLI 工作流。',
    tags: ['飞书', 'Lark', '协作'],
    highlights: ['OAuth 授权', '文档/表格读写', '发消息前确认对象'],
    installs: 0,
    skill: {
      name: '飞书 CLI',
      description: '飞书文档与消息自动化。',
      body: `## 何时用
用户要读写飞书文档/表格、或发飞书消息时。

## 步骤
1. 先确认已安装并登录飞书 CLI，且授权范围包含文档/消息。
2. 读文档先拿 doc token；写之前备份原内容或输出 diff。
3. 发消息必须确认：发给谁、哪个群、内容。
4. 权限不足时明确说缺哪个 scope。

## 质量线
- 不群发未经确认的内容。
- 不把 token 写进文档。`,
    },
  },
  {
    id: 'dingtalk-cli',
    name: '钉钉 CLI',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'ops',
    description: '钉钉工作流：OAuth、群消息、审批查询。',
    tags: ['钉钉', '审批', '消息'],
    highlights: ['OAuth2 授权', '审批只读优先', '发送前确认'],
    installs: 0,
    skill: {
      name: '钉钉 CLI',
      description: '钉钉消息与审批自动化。',
      body: `## 何时用
用户要发钉钉消息、查审批单时。

## 步骤
1. 确认 CLI 与授权；没装就说明需要企业应用凭证。
2. 审批默认只读；发起/通过审批必须用户明确指令。
3. 消息发送前列出：接收人、内容、时间。
4. 输出审批单号与状态。

## 质量线
- 不代替用户做审批决定。
- 不泄露企业通讯录。`,
    },
  },
  {
    id: 'wecom-cli',
    name: '企业微信 CLI',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'ops',
    description: '企业微信消息、文档、表格的自动化。',
    tags: ['企业微信', '消息', '文档'],
    highlights: ['corpId/secret 配置', '文档读写', '发送前确认'],
    installs: 0,
    skill: {
      name: '企业微信 CLI',
      description: '企业微信消息与文档自动化。',
      body: `## 何时用
用户要发企微消息、读写企微文档时。

## 步骤
1. 确认 corpId、agentId、secret 已配置（不要写进仓库）。
2. 文档读写先小范围试；写前输出 diff。
3. 发消息确认接收范围。
4. 权限错误时说明缺哪个应用权限。

## 质量线
- 不群发未确认内容。
- 不记录 secret。`,
    },
  },
  {
    id: 'tencent-meeting',
    name: '腾讯会议 CLI',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'ops',
    description: '创建/查询腾讯会议、管理参会与录制。',
    tags: ['腾讯会议', '会议', 'CLI'],
    highlights: ['OAuth2 授权', '创建前确认时间', '录制链接权限'],
    installs: 0,
    skill: {
      name: '腾讯会议 CLI',
      description: '腾讯会议创建与查询。',
      body: `## 何时用
用户要建会议、查参会、取录制时。

## 步骤
1. 确认 CLI 与 OAuth 授权。
2. 创建前核对：主题、开始时间、时长、时区、是否录制。
3. 返回会议号与链接；录制链接注意访问权限。
4. 取消/修改会议必须用户确认。

## 质量线
- 不擅自开启录制。
- 不公开会议链接。`,
    },
  },
  {
    id: 'browser-ops',
    name: '浏览器操作',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '用 Playwright/CDP 打开页面、点击、取文本与截图。',
    tags: ['浏览器', 'Playwright', '自动化'],
    highlights: ['先检测 Playwright', '每步截图留证', '登录态只读'],
    installs: 0,
    skill: {
      name: '浏览器操作',
      description: '浏览器自动化：打开、点击、抓取、截图。',
      body: `## 何时用
要验证网页、填表、抓取需要渲染的页面时。

## 步骤
1. 先检测：\`node -e "require('playwright')"\` 或 \`npx playwright --version\`。
2. 打开页面后先截图，再操作；每一步保留 before/after 截图。
3. 选择器优先 role/text，不用脆弱的 nth-child。
4. 涉及登录：让用户自己登录，不要代填密码。

## 质量线
- 不绕过验证码/风控。
- 不提交未确认的表单。`,
    },
  },
  {
    id: 'computer-control',
    name: '电脑控制',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'ops',
    description: '用 PowerShell/UI 自动化操作本机桌面应用。',
    tags: ['桌面', '自动化', 'Windows'],
    highlights: ['先截图确认前台', '危险点击要二次确认', '只操作指定窗口'],
    installs: 0,
    skill: {
      name: '电脑控制',
      description: 'Windows 桌面自动化与窗口操作。',
      body: `## 何时用
用户明确要求操作某个桌面应用、且没有 API/CLI 时。

## 步骤
1. 先截图确认当前前台窗口与目标窗口标题。
2. 用 PowerShell + UIAutomation/SendKeys 操作，步骤尽量小。
3. 每步后截图校验；不对就停，不连续盲点。
4. 删除/发送/支付类按钮必须用户确认。

## 质量线
- 不操作非目标窗口。
- 不输入密码。
- 失败时保留截图和日志。`,
    },
  },
  {
    id: 'mcp-tools',
    name: 'MCP 工具接入',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '接入 MCP 服务器，把外部工具变成 Bot 可调用的能力。',
    tags: ['MCP', '工具', '集成'],
    highlights: ['stdio 服务器', '先 tools/list', '按 schema 传参'],
    installs: 0,
    skill: {
      name: 'MCP 工具接入',
      description: '配置和使用 MCP 服务器。',
      body: `## 何时用
用户要把外部 MCP 服务（数据库、搜索、SaaS）接进来时。

## 步骤
1. 先确认 MCP 服务器的启动命令、参数、环境变量。
2. 连上后先 \`tools/list\` 看工具名与 schema，再决定调用。
3. 调用参数严格按 schema；缺参数先问，不猜。
4. 失败时把 JSON-RPC 错误原文贴出来。

## 质量线
- 不把 secret 写进配置仓库。
- 破坏性工具调用前确认。`,
    },
  },
  {
    id: 'finance-data',
    name: '金融数据',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'data',
    description: '行情/财报数据查询与口径核对（需数据源授权）。',
    tags: ['金融', '行情', '财报'],
    highlights: ['先确认数据源', '口径与复权说明', '不构成投资建议'],
    installs: 0,
    skill: {
      name: '金融数据',
      description: '金融数据查询、口径核对与简报。',
      body: `## 何时用
用户要查行情、财报、估值并做分析时。

## 步骤
1. 先确认数据源与授权（万得/同花顺/Tushare/交易所）。
2. 明确口径：复权方式、币种、报告期、是否调整。
3. 计算给出公式与中间值，保留两位小数并标单位。
4. 结论标注「不构成投资建议」。

## 质量线
- 不编造行情数字。
- 不同来源冲突时并列，不合并。`,
    },
  },
  {
    id: 'game-3d',
    name: '游戏 / 3D 工具',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: 'Blender / Unity / Unreal / Godot 的脚本化工作流。',
    tags: ['Blender', 'Unity', 'Godot'],
    highlights: ['先检测安装路径', '脚本化优先', '资产改动先备份'],
    installs: 0,
    skill: {
      name: '游戏 / 3D 工具',
      description: '3D 与游戏引擎的自动化工作流。',
      body: `## 何时用
用户要做 3D 资产、引擎脚本、场景批处理时。

## 步骤
1. 先确认引擎/工具版本与安装路径（Blender、Unity、Unreal、Godot）。
2. 优先命令行/脚本（Blender --background --python、Unity -batchmode）。
3. 修改资产前备份；输出 diff 或新文件，不覆盖源资产。
4. 汇报：用了哪个版本、跑了什么命令、产物路径。

## 质量线
- 不批量删除资产。
- 贴图/模型授权要确认。`,
    },
  },
  {
    id: 'mcp-filesystem',
    name: '文件系统 MCP',
    author: 'TriBot 官方',
    version: '1.0.0',
    category: 'engineering',
    description: '通过 filesystem MCP 读工作区外的 .md / 纯文本 / 目录。',
    tags: ['MCP', '文件', '只读'],
    highlights: ['read_text_file 绝对路径', '先 mcp_list 确认', '本会话授权后不再重复问'],
    installs: 0,
    skill: {
      name: '文件系统 MCP',
      description: '读工作区外的文件：filesystem MCP 的使用方法。',
      body: `## 何时用
文件不在任务工作区内，read_file 读不到时。

## 步骤
1. 先 mcp_list，确认 files 服务器与工具（read_text_file / list_directory）。
2. mcp_call：server=files，tool=read_text_file，arguments={"path":"C:\\\\绝对路径"}。
3. 首次调用会审批；选「本会话允许」后不再重复问。
4. 只读；需要写文件回工作区用 write_file。

## 质量线
- 路径必须是绝对路径且在 allowed directories 内。
- 文件不存在就直说，不要编内容。`,
    },
  },
  {
    id: 'tribot-team',
    name: 'TriBot Bot 团队',
    author: 'P3NN4L',
    version: '1.0.0',
    category: 'ops',
    description: '一个技能包含五个 Bot 角色：总管、研究员、工程师、管家、审稿人，按任务选择。',
    tags: ['Bot 团队', '角色', '编排'],
    highlights: ['先选角色再执行', '五种输出契约', '可切换团队流水线'],
    installs: 0,
    skill: {
      name: 'TriBot Bot 团队',
      description: '从五个 Bot 角色中选一个，或走总管→专家→审稿人的团队流水线。',
      body: `## 何时用
用户说“用 TriBot”“选一个 Bot”“让总管/研究员/工程师/管家/审稿人来做”，或一个任务同时包含拆解、调研、实现、验收时。

## 先选角色
如果用户没有点名，先输出菜单并等待选择：
1. 🧭 总管：拆解、分派、合并、验收
2. 🔍 研究员：检索、来源分级、交叉验证
3. 🛠 工程师：读改文件、跑命令、验证
4. ⏰ 管家：巡检、阈值判级、异常简报
5. 🧪 审稿人：对抗审查
6. 👥 团队：总管 → 研究员/工程师 → 审稿人

## 关键约束
- 选一个角色后，只套用该角色的输出契约，不要混用。
- 不编造事实、文件、命令输出或引用；没有权限就说明。
- 破坏性操作先获得批准。
- 选“团队”也不起多个进程，只是按流水线依次工作。

## 输出
按所选角色输出；团队模式最后给：结论 / 产物 / 验证 / 未完成或风险。`,
    },
  },
];
