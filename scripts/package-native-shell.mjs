// 打包 Windows 原生壳（C# WinForms + WebView2，无 Electron）
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.');
const stage = path.join(root, 'release/TriBotNative');
const appSrc = path.join(root, 'release/TriBot-win32-x64/resources/app');
const sdkDir = path.join(root, '.cache/webview2');
const sdkDlls = path.join(sdkDir, 'lib/net462');
const outDir = path.join(root, 'site/downloads');
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(stage, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(new URL(res.headers.location, url).toString(), dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', reject);
  });
}

async function ensureSdk() {
  if (fs.existsSync(path.join(sdkDlls, 'Microsoft.Web.WebView2.Core.dll'))) return;
  const ver = '1.0.4314.35';
  const zip = path.join(root, '.cache/webview2.zip');
  await download(`https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${ver}/microsoft.web.webview2.${ver}.nupkg`, zip);
  fs.mkdirSync(sdkDir, { recursive: true });
  execFileSync('tar', ['-xf', zip, '-C', sdkDir], { stdio: 'inherit' });
}

await ensureSdk();

execFileSync(csc, [
  '/nologo', '/target:winexe', '/platform:x64',
  `/out:${path.join(stage, 'TriBotShell.exe')}`,
  `/win32icon:${path.join(root, 'packages/app/assets/icon.ico')}`,
  '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Net.dll',
  `/r:${path.join(sdkDlls, 'Microsoft.Web.WebView2.Core.dll')}`,
  `/r:${path.join(sdkDlls, 'Microsoft.Web.WebView2.WinForms.dll')}`,
  path.join(root, 'shell/TriBotShell.cs'),
], { stdio: 'inherit' });

fs.rmSync(path.join(stage, 'app'), { recursive: true, force: true });
fs.cpSync(appSrc, path.join(stage, 'app'), { recursive: true });
fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(stage, 'runtime/node.exe'));
fs.copyFileSync(path.join(root, 'packages/app/assets/icon.ico'), path.join(stage, 'icon.ico'));
for (const dll of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll']) {
  fs.copyFileSync(path.join(sdkDlls, dll), path.join(stage, dll));
}
fs.copyFileSync(path.join(sdkDir, 'runtimes/win-x64/native/WebView2Loader.dll'), path.join(stage, 'WebView2Loader.dll'));
fs.writeFileSync(path.join(stage, 'README.txt'), `TriBot 原生壳（Windows，不使用 Electron）
================================================
双击 TriBotShell.exe。

结构：
  TriBotShell.exe       C# WinForms + WebView2 外壳（原生标题栏）
  runtime\\node.exe      Node 运行时
  app\\                  前端 + server.cjs + 技能
  data\\                 首次运行创建

要求：Windows 10/11 + Microsoft Edge WebView2 Runtime（新版系统自带）。
卸载：直接删目录；数据在 data\\。
`);

const out = path.join(outDir, 'TriBot-0.1.0-win-native-x64.zip');
fs.rmSync(out, { force: true });
execFileSync('tar', ['-a', '-c', '-f', out, '-C', stage, '.'], { stdio: 'inherit' });
console.log('built', out, (fs.statSync(out).size / 1e6).toFixed(1) + 'MB');
