// macOS / Linux 安装包：不预置 Electron 运行时（Windows 上解不了 mac 的符号链接），
// 由目标机器上的脚本首次运行时下载对应 Electron 并组装。Windows 版仍是完整 zip。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.');
const appSrc = path.join(root, 'release/TriBot-win32-x64/resources/app');
const outDir = path.join(root, 'site/downloads');
const stageRoot = path.join(root, '.cache/target-stage');
const VERSION = '38.8.6';
const MIRROR = `https://npmmirror.com/mirrors/electron/${VERSION}`;
fs.mkdirSync(outDir, { recursive: true });

function prepare(name) {
  const dir = path.join(stageRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(appSrc, path.join(dir, 'app'), { recursive: true });
  return dir;
}

function zip(dir, out) {
  fs.rmSync(out, { force: true });
  execFileSync('tar', ['-a', '-c', '-f', out, '-C', dir, '.'], { stdio: 'inherit' });
}

function tar(dir, out) {
  fs.rmSync(out, { force: true });
  execFileSync('tar', ['-czf', out, '-C', dir, '.'], { stdio: 'inherit' });
}

// ---------- macOS ----------
for (const arch of ['arm64', 'x64']) {
  const dir = prepare(`mac-${arch}`);
  fs.writeFileSync(path.join(dir, 'install.command'), `#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "下载 Electron 运行时（${arch}）…"
curl -L "${MIRROR}/electron-v${VERSION}-darwin-${arch}.zip" -o electron.zip
unzip -oq electron.zip
mv Electron.app TriBot.app
mv "TriBot.app/Contents/MacOS/Electron" "TriBot.app/Contents/MacOS/TriBot"
rm -f "TriBot.app/Contents/Resources/default_app.asar"
rm -rf "TriBot.app/Contents/Resources/app"
cp -R app "TriBot.app/Contents/Resources/app"
PLIST="TriBot.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable TriBot" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleName TriBot" "$PLIST" 2>/dev/null || true
xattr -dr com.apple.quarantine TriBot.app 2>/dev/null || true
rm -f electron.zip
open TriBot.app
`);
  fs.writeFileSync(path.join(dir, '使用说明.txt'), `解压后在本目录执行：
  bash install.command

它会下载 Electron 运行时（约 110MB）并组装 TriBot.app。
首次打开若被 Gatekeeper 拦截：右键 TriBot.app → 打开。
`);
  const out = path.join(outDir, `TriBot-0.1.0-mac-${arch}.zip`);
  zip(dir, out);
  console.log('built', out, (fs.statSync(out).size / 1e6).toFixed(1) + 'MB');
}

// ---------- Linux ----------
{
  const dir = prepare('linux-x64');
  fs.writeFileSync(path.join(dir, 'install.sh'), `#!/bin/sh
set -e
cd "$(dirname "$0")"
echo "下载 Electron 运行时（linux-x64）…"
curl -L "${MIRROR}/electron-v${VERSION}-linux-x64.zip" -o electron.zip
mkdir -p runtime
unzip -oq electron.zip -d runtime
rm -f runtime/resources/default_app.asar
rm -rf runtime/resources/app
cp -R app runtime/resources/app
chmod +x runtime/electron
rm -f electron.zip
exec ./runtime/electron --no-sandbox "$@"
`);
  fs.writeFileSync(path.join(dir, '使用说明.txt'), `解压后执行：
  chmod +x install.sh
  ./install.sh

会下载 Electron 运行时（约 110MB）。需要图形桌面；无显示器用 xvfb-run。
`);
  const out = path.join(outDir, 'TriBot-0.1.0-linux-x64.tar.gz');
  tar(dir, out);
  console.log('built', out, (fs.statSync(out).size / 1e6).toFixed(1) + 'MB');
}
// ---------- Windows（完整运行时） ----------
{
  const out = path.join(outDir, 'TriBot-0.1.0-win-x64.zip');
  zip(path.join(root, 'release/TriBot-win32-x64'), out);
  console.log('built', out, (fs.statSync(out).size / 1e6).toFixed(1) + 'MB');
}

console.log('done');
