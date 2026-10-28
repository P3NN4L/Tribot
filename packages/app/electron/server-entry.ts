// server 独立入口（被 esbuild 打包成 build/server.cjs，由 Electron 主进程或命令行启动）
import { startServer } from '@tribot/server';

void startServer();
