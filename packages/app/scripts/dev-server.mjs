// 只启动 server（浏览器访问渲染层 / CLI 联调用）
import esbuild from 'esbuild';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '../..');
const buildDir = path.join(appDir, 'build');
fs.mkdirSync(buildDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(appDir, 'electron/server-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(buildDir, 'server.cjs'),
  external: ['electron', 'playwright-core'],
  logLevel: 'error',
});

console.log('[dev:server] server 运行中（Ctrl+C 退出）');
const child = fork(path.join(buildDir, 'server.cjs'), [], {
  cwd: repoRoot,
  env: { ...process.env, TRIBOT_ROOT: repoRoot, TRIBOT_AUTOSTART: '1' },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
