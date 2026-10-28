# TriBot Bot Skills for ZCode

把 TriBot 的五个 Bot 角色打包成 ZCode 可加载的 `SKILL.md`。它们是**指令型技能**，不包含可执行代码、不携带 API Key、不会自动调用模型。

| 技能 | 角色 | 用途 |
|---|---|---|
| `tribot-team` | 团队编排 | 选择角色、默认流水线、交付标准 |
| `tribot-dispatcher` | 总管 | 拆解、五段分派、合并、验收 |
| `tribot-researcher` | 研究员 | 多角度检索、来源分级、交叉验证 |
| `tribot-engineer` | 工程师 | 读改文件、跑命令、验证、失败上报 |
| `tribot-steward` | 管家 | 巡检、阈值判级、异常简报 |
| `tribot-reviewer` | 审稿人 | 对抗审查、引用/边界/可执行性 |

## 安装

ZCode 会扫描以下位置（优先级从高到低）：

1. 显式配置的技能根
2. `~/.zcode/skills`
3. `~/.agents/skills`
4. 当前 workspace 的 `.zcode/skills`

### macOS / Linux

```bash
mkdir -p ~/.zcode/skills
cp -R zcode-skills/* ~/.zcode/skills/
```

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.zcode\skills" | Out-Null
Copy-Item -Recurse zcode-skills\* "$env:USERPROFILE\.zcode\skills\"
```

也可以只装到某个项目：

```bash
mkdir -p .zcode/skills
cp -R zcode-skills/* .zcode/skills/
```

重启 ZCode 或重新加载技能后，在 **Settings → Skills** 或输入框的 `/` 菜单里应能看到 `tribot-*`。

## 使用

```
用 tribot-team 规划这个任务，再按需加载研究员/工程师。
```

或直接点名：

```
加载 tribot-engineer，修复这个构建错误并给出验证输出。
```

ZCode 的技能是“按需加载的指令”，不是子代理；`tribot-team` 只负责告诉主 Agent 怎么拆分和选择角色，不会自动起五个进程。

## 格式

每个目录一个 `SKILL.md`，frontmatter 使用 ZCode 支持的扁平字段：

```yaml
---
name: tribot-engineer
description: ...
when_to_use: ...
license: MIT
metadata: role=engineer; source=TriBot
---
```

描述控制在 1024 字符以内；`description` 明确写“什么时候用”，模型才会在合适的时候触发。

## 安全

- 不包含任何 API Key、token、内部地址
- 不包含可执行脚本
- 所有破坏性操作仍由当前 ZCode 的权限/审批机制约束
