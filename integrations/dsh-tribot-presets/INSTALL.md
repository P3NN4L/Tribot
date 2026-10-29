# 安装 / 验证 / 回滚

## 前提

- `dsh-tribot-team` 已安装到 profile（依赖已在 package.json）
- 本目录 `presets.yml` 中的 5 份预设声明

## 安装步骤

### 1. 把 5 份预设声明复制进 profile patch

打开 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，
把 `presets.yml` 的全部内容粘贴到文件末尾。

### 2. 给子代理工具加预设白名单

在同一文件里找到 subagent 工具的条目（`id` 含 `subagent`），
在其 `config` 里加入：

```yaml
allowedAgentPresets:
  - tribot-dispatcher
  - tribot-researcher
  - tribot-engineer
  - tribot-steward
  - tribot-reviewer
```

> 先跑一次 `dsh --dump-config`（或在 Web 设置页看 subagent 条目的实际 id），
> 覆盖条目的 id 必须与组合中的完全一致。

### 3. 重启 DSH

## 验证

1. 新会话里让模型委派一个任务，观察子代理是否以对应角色工作
2. `dsh --dump-config`（只读）确认 5 份预设出现在组合树里
3. 插件管理页确认 `dsh-tribot-team` 已启用、无报错

## 回滚

```powershell
# 移除 5 份预设声明与 allowedAgentPresets 覆盖（保留 dsh-tribot-team 依赖）
```

或直接用安装前的 `cordis.patch.yml` 备份覆盖回去，再重启 DSH。

## 已知取舍

- preset 子代理走进程内 spawn：首轮冷启动（全新前缀全价），换来**系统级角色人格**
- fork 委派不接纳 preset——需要继承父上下文时用普通 spawn + 分派卡角色卡
