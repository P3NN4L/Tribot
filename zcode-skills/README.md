# TriBot Skill for ZCode

一个技能，五个 Bot 角色。加载后先让你选角色，再按对应方法论执行。

| 编号 | 角色 | 用途 |
|---|---|---|
| 1 | 🧭 总管 | 拆解、五段分派、合并、验收 |
| 2 | 🔍 研究员 | 多角度检索、来源分级、交叉验证 |
| 3 | 🛠 工程师 | 读改文件、跑命令、验证、失败上报 |
| 4 | ⏰ 管家 | 巡检、阈值判级、异常简报 |
| 5 | 🧪 审稿人 | 对抗审查：结论/引用/边界/可执行性 |
| 6 | 👥 团队 | 总管 → 研究员/工程师 → 审稿人 |

## 安装

ZCode 会扫描以下位置（优先级从高到低）：

1. 显式配置的技能根
2. `~/.zcode/skills`
3. `~/.agents/skills`
4. 当前 workspace 的 `.zcode/skills`

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.zcode\skills" | Out-Null
Copy-Item -Recurse zcode-skills\tribot "$env:USERPROFILE\.zcode\skills\"
```

### macOS / Linux

```bash
mkdir -p ~/.zcode/skills
cp -R zcode-skills/tribot ~/.zcode/skills/
```

只装到某个项目：

```bash
mkdir -p .zcode/skills
cp -R zcode-skills/tribot .zcode/skills/
```

重启 ZCode 或重新加载技能后，在 **Settings → Skills** 或输入框的 `/` 菜单里应能看到 `tribot`。

## 使用

```
/tribot
```

或：

```
用 tribot 帮我做这个任务，先让我选角色。
```

技能会先输出菜单：

```
1. 🧭 总管
2. 🔍 研究员
3. 🛠 工程师
4. ⏰ 管家
5. 🧪 审稿人
6. 👥 团队
```

回复编号或名字即可。也可以直接说「用工程师」，技能会跳过菜单。

## 说明

- 这是**指令型技能**，不是子代理；选 6 也不会起五个进程，只是让同一个 Agent 按团队流水线工作。
- 不包含任何 API Key、token、内部地址或可执行脚本。
- 破坏性操作仍由 ZCode 的权限/审批机制约束。
- ZCode 的 skill 参数不会注入正文，所以“选角色”走对话确认，而不是命令行参数。

## 格式

```yaml
---
name: tribot
description: ...
when_to_use: ...
license: MIT
metadata: roles=dispatcher,researcher,engineer,steward,reviewer; source=TriBot
---
```

描述控制在 1024 字符内，并明确写“什么时候用”，模型才会在合适的时候触发。
