// 轻量安装包：把便携版 + 安装/卸载脚本打成 release/TriBot-Setup
// 不依赖 NSIS / electron-builder，双击「安装 TriBot.bat」即可。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.');
const src = path.join(root, 'release/TriBot-win32-x64');
const out = path.join(root, 'release/TriBot-Setup');
const payload = path.join(out, 'TriBot');

if (!fs.existsSync(path.join(src, 'TriBot.exe'))) {
  console.error('先跑 pnpm package 生成 release/TriBot-win32-x64');
  process.exit(1);
}

console.log('[installer] 复制便携版…');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(src, payload, { recursive: true });

const BOM = '\uFEFF';
const install = `${BOM}param(
  [string]$InstallDir = "$env:LOCALAPPDATA\\Programs\\TriBot",
  [switch]$NoDesktop,
  [switch]$NoStartMenu,
  [switch]$SkipRegistry
)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'TriBot'
if (-not (Test-Path (Join-Path $src 'TriBot.exe'))) { throw '安装包不完整：找不到 TriBot.exe' }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $InstallDir -Recurse -Force
$exe = Join-Path $InstallDir 'TriBot.exe'
$icon = Join-Path $InstallDir 'resources\\app\\assets\\icon.ico'
$ws = New-Object -ComObject WScript.Shell
if (-not $NoDesktop) {
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'TriBot.lnk'
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $exe; $sc.WorkingDirectory = $InstallDir
  $sc.IconLocation = "$icon,0"; $sc.Description = 'TriBot · 本地 Bot 团队工作台'
  $sc.Save()
}
if (-not $NoStartMenu) {
  $dir = Join-Path ([Environment]::GetFolderPath('Programs')) 'TriBot'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $lnk = Join-Path $dir 'TriBot.lnk'
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $exe; $sc.WorkingDirectory = $InstallDir
  $sc.IconLocation = "$icon,0"; $sc.Description = 'TriBot · 本地 Bot 团队工作台'
  $sc.Save()
}
Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') (Join-Path $InstallDir 'uninstall.ps1') -Force
if (-not $SkipRegistry) {
  $key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TriBot'
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name DisplayName -Value 'TriBot'
  Set-ItemProperty -Path $key -Name DisplayVersion -Value '0.1.0'
  Set-ItemProperty -Path $key -Name Publisher -Value 'TriBot'
  Set-ItemProperty -Path $key -Name InstallLocation -Value $InstallDir
  Set-ItemProperty -Path $key -Name DisplayIcon -Value $icon
  Set-ItemProperty -Path $key -Name UninstallString -Value "powershell -ExecutionPolicy Bypass -File \\"$InstallDir\\uninstall.ps1\\""
}
Write-Host "已安装到 $InstallDir"
Write-Host '从桌面或开始菜单启动 TriBot 即可。'
`;

const uninstall = `${BOM}param([string]$InstallDir = "$env:LOCALAPPDATA\\Programs\\TriBot")
$ErrorActionPreference = 'SilentlyContinue'
$ws = New-Object -ComObject WScript.Shell
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'TriBot.lnk'
if (Test-Path $desktopLnk) {
  $sc = $ws.CreateShortcut($desktopLnk)
  if ($sc.TargetPath -like "$InstallDir*") { Remove-Item $desktopLnk -Force }
}
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'TriBot'
if (Test-Path $menu) {
  $menuLnk = Join-Path $menu 'TriBot.lnk'
  if (Test-Path $menuLnk) {
    $sc = $ws.CreateShortcut($menuLnk)
    if ($sc.TargetPath -notlike "$InstallDir*") { $menuLnk = $null }
  }
  if ($menuLnk) { Remove-Item $menu -Recurse -Force }
}
Remove-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TriBot' -Recurse -Force
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
Write-Host '已卸载 TriBot（数据仍在 %APPDATA%\\TriBot，如需彻底删除请手动删）'
`;

const bat = `@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
`;

const readme = `TriBot 安装说明
================
1. 双击「安装 TriBot.bat」
2. 默认装到 %LOCALAPPDATA%\\Programs\\TriBot，并创建桌面/开始菜单快捷方式
3. 卸载：运行安装目录里的 uninstall.ps1，或 Windows「应用和功能」里的 TriBot

数据位置：%APPDATA%\\TriBot（卸载不会删除，方便保留会话与凭证）
`;

fs.writeFileSync(path.join(out, 'install.ps1'), install, 'utf8');
fs.writeFileSync(path.join(out, 'uninstall.ps1'), uninstall, 'utf8');
fs.writeFileSync(path.join(out, '安装 TriBot.bat'), bat, 'utf8');
fs.writeFileSync(path.join(out, 'README.txt'), readme, 'utf8');

console.log('[installer] 自测安装到临时目录…');
const testDir = path.join(process.env.TEMP ?? '.', 'TriBot-InstallTest');
try {
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(out, 'install.ps1'),
    '-InstallDir', testDir, '-NoDesktop', '-NoStartMenu', '-SkipRegistry',
  ], { stdio: 'inherit' });
  if (!fs.existsSync(path.join(testDir, 'TriBot.exe'))) throw new Error('安装后找不到 TriBot.exe');
  console.log('[installer] 自测通过，清理临时安装…');
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(out, 'uninstall.ps1'), '-InstallDir', testDir,
  ], { stdio: 'inherit' });
} catch (e) {
  console.error('[installer] 自测失败：', e.message);
  process.exitCode = 1;
}

console.log('[installer] 完成：', out);
