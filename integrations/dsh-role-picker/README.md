# DSH TriBot Role Picker

DSH 输入框左侧的角色选择器：点一下 **「选择角色」**，在菜单里选，自动插入 `/tribot 工程师 `。颜色、亮/暗外观和语言都跟随 DSH 设置。

## 效果

DSH 输入框左侧会出现一个小胶囊，**不显示 TriBot 字样**：

```
[ 选择角色 ▾ ]
```

点开：

```
🧭 总管      拆解、分派、合并、验收
🔍 研究员    检索、来源分级、交叉验证
🛠 工程师    读改文件、跑命令、验证
⏰ 管家      巡检、阈值判级、异常简报
🧪 审稿人    对抗审查
👥 团队      总管 → 专家 → 审稿人
```

选中后草稿变成：

```
/tribot 工程师 
```

发送后 DSH 加载 `tribot` 技能，按工程师协议执行；技能会在回复顶部显示当前角色。

`#` 仍然保留为快捷键：输入 `#` 也会弹出同一个角色菜单。

## 安装

前提：DSH 已安装并可正常使用 `inputTriggers` 服务（当前 DSH 内置）。

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
# 1. 链接本插件
pnpm --dir $profile add "dsh-tribot-role-picker=link:C:/Users/admin/Desktop/Tribot/integrations/dsh-role-picker"
# 2. 把 dsh-tribot-role-picker 加进 dsh.profile.bundles
#    编辑 $profile\package.json，在 dsh.profile.bundles 末尾加一行
```

`package.json` 示例：

```json
{
  "dependencies": {
    "dsh-tribot-role-picker": "link:C:/Users/admin/Desktop/Tribot/integrations/dsh-role-picker"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-tribot-role-picker"
      ]
    }
  }
}
```

然后重启 DSH（或重新加载 profile）。

## 构建

```bash
cd integrations/dsh-role-picker
node build.mjs
```

产物：

- `lib/index.js` — host 空插件
- `lib/client.js` — 注册 `#` 输入触发源

## 说明

- 这是 **DSH 客户端插件**，不是 `SKILL.md`；`SKILL.md` 本身不能画输入框菜单。
- 不包含 API Key、RPC 或宿主状态；纯前端选择。
- 只注册 `#` 触发源，不影响 `@` 文件引用和 `/` 技能菜单。
- 选择后插入 `/tribot <角色>`，角色名在消息里可见。
- 胶囊旁有一个**小开关**：关闭只隐藏选角 UI 并停用 `#` 触发（插件本体常驻、始终出现在插件列表）；同时会往草稿填入停用标记，发送后当前会话立即退出 TriBot 角色。
