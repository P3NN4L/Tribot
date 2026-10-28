# 原生壳（不再用 Electron）

## 为什么换

Electron 是「Chromium + Node + 自己的窗口」，体积大、进程多、窗口控制要自己模拟，而且用户看到的是 `electron.exe`。
TriBot 的界面本来就是网页，完全可以用**系统自带 WebView** 承载；壳只负责开窗、启动本地 server、退出时收拾进程。

## Windows 实现

```
release/TriBotNative/
  TriBotShell.exe          C# WinForms，原生标题栏
  runtime/node.exe         Node 运行时
  app/                     前端构建 + server.cjs + 技能
  data/                    配置/会话/凭证（运行时创建）
  Microsoft.Web.WebView2.*.dll
  WebView2Loader.dll
  icon.ico
```

- 窗口：WinForms `Form`，系统标题栏，最小化/最大化/关闭由 Windows 处理
- 页面：`WebView2` 加载 `http://127.0.0.1:<port>/`（server 直接托管前端）
- 后端：启动 `runtime/node.exe app/build/server.cjs`，随机端口，退出时 kill
- 安全：C# 用 DPAPI 生成/保护主密钥 `data/.shellkey`，通过 `TRIBOT_MASTER_KEY` 传给 server
- 体积：约 40MB（Electron 版 138MB）

编译（Windows，自带 .NET Framework 的 csc 即可）：

```powershell
node scripts/package-native-shell.mjs
# 产物：release/TriBotNative + site/downloads/TriBot-0.1.0-win-native-x64.zip
```

## macOS / Linux

壳代码在 `shell/tribot_shell.py`（Python + pywebview）：

- macOS：WKWebView
- Linux：WebKitGTK

```bash
python -m pip install pywebview
python tribot_shell.py
```

没有在本机交叉编译 mac/linux 二进制：原生 WebView 壳必须在对应平台编译、签名；源码包已放到下载站。

## 与 Electron 版的关系

- 原生壳与 Electron 版共用同一个 `app/`（前端 + server + 技能）
- 数据目录相同的话，凭证会在 `.localkey` / DPAPI 主密钥之间迁移；迁移失败不会覆盖原文件
- Electron 版仍保留，直到原生壳在三个平台都稳定
