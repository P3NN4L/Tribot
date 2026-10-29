# TriBot 角色预设（层 2：系统级角色）

把五个 TriBot 角色做成 DSH 原生 **agentPreset**：子代理启动时系统提示**天生就是该角色**（不靠消息注入），并可按角色配置工具边界。

## 这是什么

| 文件 | 作用 |
|---|---|
| `presets.yml` | 5 份 agentPreset 声明 + 子代理工具白名单覆盖（复制进 profile 的 cordis.patch.yml） |
| `INSTALL.md` | 一步步安装 / 验证 / 回滚 |

每个预设 = `@deepseek-ai/dsh-agent-preset`（id: tribot-<角色>）+ 插件列表：

- `dsh-tribot-team`（本仓库的 npm 包）→ host 半为该 preset 的 agent 注册完整 `/tribot` 技能（分派卡里点名角色即按该角色契约交付）
- `@deepseek-ai/dsh-agent-instructions` → 工作区指令加载（保持默认）

## 委派时的选择

子代理工具配置 `allowedAgentPresets` 后，模型委派时可传：

```
agent_preset: tribot-engineer
```

子代理启动即以工程师人格 + 工程师输出契约工作。

## 已知取舍

- **preset 只支持进程内 spawn**（fork 拒绝 agentPreset）→ preset 子代理首轮冷启动（全新前缀全价）；作为交换获得系统级人格
- **不要在委派时传 provider/model 覆盖**——换路由会让缓存/前缀行为劣化
- 与 skill 条目（P3NN4L/Tribot）不冲突；同名技能若重复安装以先发现者为准

## 安装

见 [INSTALL.md](INSTALL.md)。全程可回滚（备份 + 一条命令移除）。
