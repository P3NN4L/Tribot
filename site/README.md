# TriBot 下载站

静态站点，`index.html` + `style.css` + `downloads/`。

## 本地预览

```powershell
python -m http.server 8090 --directory site
# 打开 http://127.0.0.1:8090
```

## 生成下载产物

```powershell
pnpm package              # Windows 便携版
node scripts/package-target-installers.mjs
```

产物：

- `site/downloads/TriBot-0.1.0-win-x64.zip`（完整运行时）
- `site/downloads/TriBot-0.1.0-mac-arm64.zip`（安装脚本，首次下载 Electron）
- `site/downloads/TriBot-0.1.0-mac-x64.zip`
- `site/downloads/TriBot-0.1.0-linux-x64.tar.gz`

macOS / Linux 不预置 Electron 运行时：在 Windows 上解压 mac 包会遇到符号链接/执行权限问题，
安装脚本会在目标机器上下载对应 Electron 再组装。

## 部署

把 `site/` 整个目录上传到任意静态托管（Cloudflare Pages / GitHub Pages / Nginx）。
`downloads/` 里的大文件需要一起上传，或改为对象存储链接。
