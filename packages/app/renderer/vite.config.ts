import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rendererDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  root: rendererDir,
  // 打包后是 file:// 加载，资源必须用相对路径，否则 /assets/* 会解析到盘符根目录 → 黑屏
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: false,
    // 编辑器/代理落下的临时目录会让 watcher 抛 EBUSY，直接忽略
    watch: { ignored: ['**/*.tmpdir/**', '**/*.tmp', '**/.git/**'] },
  },
  preview: {
    host: '127.0.0.1',
  },
  build: {
    outDir: path.join(rendererDir, '../build/renderer'),
    emptyOutDir: true,
  },
}));
