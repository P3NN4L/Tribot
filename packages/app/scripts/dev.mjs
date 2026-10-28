// 开发模式：打包 server/main/preload → 拉起 server 子进程 + vite → 等就绪 → 启动 Electron
import esbuild from 'esbuild';
import { spawn, fork } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '../..');
const buildDir = path.join(appDir, 'build');
fs.mkdirSync(buildDir, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

console.log('[dev] 1/4 esbuild 打包 server / main / preload…');
for (const [entry, outfile] of [
  ['electron/server-entry.ts', 'server.cjs'],
  ['electron/main.ts', 'main.cjs'],
  ['electron/preload.ts', 'preload.cjs'],
]) {
  await esbuild.build({
    entryPoints: [path.join(appDir, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(buildDir, outfile),
    external: ['electron'],
    sourcemap: false,
    logLevel: 'error',
  });
}

const serverPort = await freePort();
console.log(`[dev] 2/4 启动 server 子进程（端口 ${serverPort}）…`);
const serverProc = fork(path.join(buildDir, 'server.cjs'), [], {
  cwd: repoRoot,
  env: { ...process.env, TRIBOT_ROOT: repoRoot, TRIBOT_PORT: String(serverPort), TRIBOT_AUTOSTART: '1' },
  stdio: 'inherit',
});

const vitePort = await freePort();
console.log(`[dev] 3/4 启动 vite（渲染层，端口 ${vitePort}）…`);
const viteBin = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
const viteProc = spawn(process.execPath, [
  viteBin, '-c', 'renderer/vite.config.ts', '--port', String(vitePort), '--strictPort',
], { cwd: appDir, stdio: 'inherit' });

const viteUrl = `http://127.0.0.1:${vitePort}/`;
if (!(await waitHttp(viteUrl))) {
  console.error('[dev] vite 启动超时，退出');
  process.exit(1);
}

console.log('[dev] 4/4 启动 Electron（cli.js 是 Electron 的启动器）…');
const electronCli = path.join(appDir, 'node_modules', 'electron', 'cli.js');
const electronProc = spawn(process.execPath, [electronCli, appDir], {
  cwd: repoRoot,
  env: {
    ...process.env,
    TRIBOT_DEV_URL: viteUrl,
    TRIBOT_PORT: String(serverPort),
    TRIBOT_ROOT: repoRoot,
    NODE_ENV: 'development',
  },
  stdio: 'inherit',
});

const cleanup = () => {
  for (const p of [electronProc, serverProc, viteProc]) {
    try { p.kill(); } catch { /* ignore */ }
  }
};
electronProc.on('exit', (code) => {
  console.log(`[dev] Electron 退出（code=${code}），收尾`);
  cleanup();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
