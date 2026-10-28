# TriBot Skill for DSH

DSH（DeepSeek Harness）也支持 `SKILL.md`，格式和 ZCode 基本一致，但字段名是 **`whenToUse`（驼峰）**，技能根目录也不同。

同一个技能文件已经同时写了两套字段：

- `when_to_use` → ZCode
- `whenToUse` → DSH
- 两边都会忽略对方不认识的字段

## 安装

DSH 会扫描（优先级从高到低）：

| 优先级 | 来源 | 路径 |
|---|---|---|
| 100 | 项目 | `<projectRoot>/.dsh/skills` |
| 200 | 项目 | `<projectRoot>/.agents/skills` |
| 400 | 用户 | `~/.dsh/skills` |
| 500 | 用户 | `~/.agents/skills` |

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\skills" | Out-Null
Copy-Item -Recurse ..\zcode-skills\tribot "$env:USERPROFILE\.dsh\skills\"
```

### macOS / Linux

```bash
mkdir -p ~/.dsh/skills
cp -R ../zcode-skills/tribot ~/.dsh/skills/
```

也可以只装到某个项目：

```bash
mkdir -p .dsh/skills
cp -R zcode-skills/tribot .dsh/skills/
```

DSH 会监听这些目录，新增/修改/删除技能不需要重启；刷新后加载 `tribot` 即可。

## 使用

```
加载 tribot，先让我选角色。
```

技能会输出菜单：

```
1. 🧭 总管   2. 🔍 研究员   3. 🛠 工程师
4. ⏰ 管家   5. 🧪 审稿人   6. 👥 团队
```

回复编号或名字。DSH 的 skill 参数同样不会注入正文，所以选角色走对话确认。

## 说明

- 指令型技能，不含 API Key 或可执行脚本。
- 选“团队”也不会起多个进程；只是让当前 Agent 按流水线工作。
- 破坏性操作仍受 DSH 的权限机制约束。

## 文件

- [`../zcode-skills/tribot/SKILL.md`](../zcode-skills/tribot/SKILL.md) — 唯一源文件，ZCode / DSH 共用。
