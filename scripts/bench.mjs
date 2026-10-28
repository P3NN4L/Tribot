// 构建并运行 bench-context.ts（esbuild 打包成 cjs 再跑）
import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, '.tmp', 'bench-context.cjs');
await esbuild.build({
  entryPoints: [path.join(root, 'scripts', 'bench-context.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile,
  external: ['playwright-core', 'chromium-bidi', 'chromium-bidi/*'],
  logLevel: 'error',
});
const r = spawnSync(process.execPath, [outfile], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: path.join(root, 'packages/app/node_modules') },
});
process.exit(r.status ?? 1);
