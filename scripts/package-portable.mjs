// 便携版打包：electron 运行时 + 我们自己的 app（build/ + assets/）
// 产物：release/TriBot-win32-x64/TriBot.exe（双击即用，数据在 %APPDATA%\TriBot）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const appDir = path.join(repoRoot, 'packages/app');
const esbuild = createRequire(path.join(appDir, 'package.json'))('esbuild');
const buildDir = path.join(appDir, 'build');
const releaseDir = path.join(repoRoot, 'release/TriBot-win32-x64');
const staging = path.join(appDir, 'build/app');

fs.mkdirSync(buildDir, { recursive: true });

console.log('[package] 1/5 编译主进程与 server…');
for (const [entry, out] of [
  ['electron/main.ts', 'main.cjs'],
  ['electron/preload.ts', 'preload.cjs'],
  ['electron/server-entry.ts', 'server.cjs'],
]) {
  await esbuild.build({
    entryPoints: [path.join(appDir, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(buildDir, out),
    external: ['electron', 'playwright-core', 'chromium-bidi', 'chromium-bidi/*'],
    logLevel: 'error',
  });
}

console.log('[package] 2/5 构建渲染层…');
// Windows Defender 会锁系统 TEMP 里的 esbuild 临时文件；构建时改用仓库内临时目录
const esbuildTmp = path.join(appDir, '..', '..', '.cache', 'esbuild-tmp');
fs.mkdirSync(esbuildTmp, { recursive: true });
execFileSync(process.execPath, [
  path.join(appDir, 'node_modules/vite/bin/vite.js'),
  'build',
  '-c', path.join(appDir, 'renderer/vite.config.ts'),
], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, TEMP: esbuildTmp, TMP: esbuildTmp },
});

console.log('[package] 3/5 组装 app…');
fs.rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
fs.mkdirSync(path.join(staging, 'build'), { recursive: true });
for (const f of ['main.cjs', 'preload.cjs', 'server.cjs']) {
  fs.copyFileSync(path.join(buildDir, f), path.join(staging, 'build', f));
}
fs.cpSync(path.join(buildDir, 'renderer'), path.join(staging, 'build/renderer'), { recursive: true });
fs.cpSync(path.join(appDir, 'assets'), path.join(staging, 'assets'), { recursive: true });
// 内置基础技能：首次安装时由 server 播种到 data/skills
const seedSkills = path.join(repoRoot, 'data/skills');
if (fs.existsSync(seedSkills)) {
  fs.cpSync(seedSkills, path.join(staging, 'seed-skills'), { recursive: true });
}
// playwright-core 不能 bundle（依赖自身 browsers.json），以真实包形式随应用携带
const pwCore = path.join(repoRoot, 'packages/core/node_modules/playwright-core');
if (fs.existsSync(pwCore)) {
  fs.cpSync(pwCore, path.join(staging, 'node_modules/playwright-core'), { recursive: true, dereference: true });
}
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
  name: 'tribot',
  version: '0.1.0',
  description: 'TriBot · 本地 Bot 团队工作台',
  main: 'build/main.cjs',
  private: true,
}, null, 2));

console.log('[package] 4/5 复制 Electron 运行时…');
fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
if (fs.existsSync(releaseDir)) throw new Error(`清理 ${releaseDir} 失败（先关闭 TriBot）`);
fs.cpSync(path.join(appDir, 'node_modules/electron/dist'), releaseDir, { recursive: true });
const exe = path.join(releaseDir, 'electron.exe');
if (fs.existsSync(exe)) fs.renameSync(exe, path.join(releaseDir, 'TriBot.exe'));
const defaultApp = path.join(releaseDir, 'resources/default_app.asar');
if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp);

console.log('[package] 5/5 放入 app…');
const appDest = path.join(releaseDir, 'resources/app');
try {
  fs.rmSync(appDest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (e) {
  throw new Error(`清理 ${appDest} 失败（先关闭正在运行的 TriBot）：${e.message}`);
}
if (fs.existsSync(appDest)) throw new Error(`清理 ${appDest} 失败：目录仍存在（先关闭 TriBot）`);
fs.cpSync(staging, appDest, { recursive: true });

console.log('[package] 完成:', path.join(releaseDir, 'TriBot.exe'));
