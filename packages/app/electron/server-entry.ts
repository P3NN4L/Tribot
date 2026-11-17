// server 独立入口（被 esbuild 打包成 build/server.cjs，由 Electron 主进程或命令行启动）
// R8：启动失败必须显式记录并以非零码退出，主进程据此决定重启/报错，
// 而不是留下一个"窗口在、后端没了"的黑洞。
import { startServer } from '@tribot/server';

startServer().catch((e: unknown) => {
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  console.error('[TriBot] server 启动失败：', msg);
  process.exit(1);
});
