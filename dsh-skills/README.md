# TriBot Skill for DSH

DSH（DeepSeek Harness）也支持 `SKILL.md`，格式和 ZCode 基本一致，但字段名是 **`whenToUse`（驼峰）**，技能根目录也不同。

> 技能本体就是仓库根目录的 [`SKILL.md`](../SKILL.md)，里面同时写了两套字段：
>
> - `when_to_use` → ZCode
> - `whenToUse` → DSH
> - 两边都会忽略对方不认识的字段

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
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\skills\tribot" | Out-Null
Copy-Item SKILL.md "$env:USERPROFILE\.dsh\skills\tribot\SKILL.md"
```

### macOS / Linux

```bash
mkdir -p ~/.dsh/skills/tribot
cp SKILL.md ~/.dsh/skills/tribot/SKILL.md
```

只装到某个项目：

```bash
mkdir -p .dsh/skills/tribot
cp SKILL.md .dsh/skills/tribot/SKILL.md
```

DSH 会监听这些目录，新增/修改/删除技能不需要重启；刷新后加载 `tribot` 即可。

> 想在 DSH 输入框旁直接点选角色，装仓库里的客户端插件
> [`integrations/dsh-role-picker`](../integrations/dsh-role-picker/)。

## 使用

```
/tribot 总管
```

技能会输出菜单：

```
1. 🧭 总管   2. 🔍 研究员   3. 🛠 工程师
4. ⏰ 管家   5. 🧪 审稿人   6. 👥 团队
```

回复编号或名字。DSH 的 skill 参数同样不会注入正文，所以选角色走对话确认。

## 说明

- 指令型技能，不含密钥或可执行脚本。
- 选「团队」也不会起多个进程；只是让当前 Agent 按流水线工作。
- 破坏性操作仍受 DSH 的权限机制约束。

## 文件

- [`../SKILL.md`](../SKILL.md) — 唯一源文件，DSH / ZCode 共用。
