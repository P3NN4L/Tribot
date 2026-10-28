import { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, safeStorage, screen, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ===== TriBot 桌面主进程：拉起本地 server 子进程 → 打开工作台窗口 → 托盘常驻 =====

// 启动期崩溃排查：写一份堆栈到临时目录（打包后看不到控制台）
try {
  const dump = (tag: string, e: unknown) => {
    try {
      const file = path.join(process.env.TEMP ?? '.', 'tribot-boot-error.txt');
      fs.writeFileSync(file, `${tag} ${new Date().toISOString()}\n${(e as any)?.stack ?? String(e)}\n`, { flag: 'a' });
    } catch { /* ignore */ }
  };
  process.on('uncaughtException', (e) => dump('uncaughtException', e));
  process.on('unhandledRejection', (e) => dump('unhandledRejection', e));
} catch { /* ignore */ }

const isDev = !!process.env.TRIBOT_DEV_URL;

// 必须在拿单实例锁之前：把 userData 收到 data/electron，避免 %APPDATA% 权限问题
// （锁文件、缓存、GPU 缓存都建在这个目录里；顺带让 App 状态跟着项目数据走）
try {
  const ud = path.join(dataDir(), 'electron');
  fs.mkdirSync(ud, { recursive: true });
  app.setPath('userData', ud);
} catch { /* 不可写就退回默认 */ }
app.setAppUserModelId('com.tribot.workbench');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const PACKAGED = process.env.TRIBOT_PACKAGED === '1' || app.isPackaged;

function findProjectRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function dataDir(): string {
  if (process.env.TRIBOT_DATA_DIR) return process.env.TRIBOT_DATA_DIR;
  if (PACKAGED) {
    return path.join(app.getPath('appData'), 'TriBot');
  }
  const root = findProjectRoot(__dirname) ?? path.join(app.getPath('appData'), 'TriBot');
  return path.join(root, 'data');
}

async function fetchHealth(port: number, timeoutMs = 700): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    const j: any = await res.json();
    return !!j?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function readDaemonPort(): Promise<number | null> {
  try {
    const raw = fs.readFileSync(path.join(dataDir(), 'daemon.json'), 'utf8');
    const j = JSON.parse(raw);
    return typeof j?.port === 'number' ? j.port : null;
  } catch {
    return null;
  }
}

let serverProc: ChildProcess | null = null;

/**
 * 凭证主密钥：32 字节随机数，用系统 DPAPI（safeStorage）加密后存 data/.masterkey。
 * 启动时解密后通过 TRIBOT_MASTER_KEY 传给 server 子进程，凭证文件里的 Key 都是 AES-256-GCM 密文。
 */
function ensureMasterKey(): string | null {
  const file = path.join(dataDir(), '.masterkey');
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    if (safeStorage.isEncryptionAvailable()) {
      if (fs.existsSync(file)) return safeStorage.decryptString(fs.readFileSync(file));
      const key = crypto.randomBytes(32).toString('base64');
      fs.writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 });
      return key;
    }
    // 极端情况（系统加密不可用）：退化为本地随机密钥文件，仍然不是明文
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim() || null;
    const key = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(file, key, { mode: 0o600 });
    return key;
  } catch {
    return null;
  }
}

async function spawnServer(): Promise<number> {
  const root = PACKAGED ? dataDir() : findProjectRoot(__dirname);
  const serverJs = path.join(__dirname, 'server.cjs');
  // 用 Electron 自带的 Node 跑 server 子进程（dev/打包 一致）
  serverProc = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      TRIBOT_ROOT: root,
      TRIBOT_DATA_DIR: dataDir(),
      TRIBOT_PACKAGED: PACKAGED ? '1' : '0',
      ...(ensureMasterKey() ? { TRIBOT_MASTER_KEY: ensureMasterKey()! } : {}),
      TRIBOT_AUTOSTART: '1',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on('exit', (code) => {
    serverProc = null;
    if (code && code !== 0) console.error(`[tribot] server 退出 code=${code}`);
  });

  // 等健康检查通过（最多 25 秒）
  const preferred = Number(process.env.TRIBOT_PORT || 47615);
  for (let i = 0; i < 50; i++) {
    const daemonPort = await readDaemonPort();
    if (daemonPort && (await fetchHealth(daemonPort))) return daemonPort;
    if (i > 8 && (await fetchHealth(preferred))) return preferred;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server 启动超时');
}

async function ensurePort(): Promise<number> {
  const daemonPort = await readDaemonPort();
  if (daemonPort && (await fetchHealth(daemonPort))) return daemonPort;
  return spawnServer();
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let hideNoticeShown = false;

// 16x16 蓝色圆点托盘图标（内嵌 PNG，无需外部文件）
const TRAY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAmElEQVR4nKWTwQ3DIAxFn9k/pM5QhWi' +
  'dITN0hZAK5UJHCKFwCOdzMk4rBf4vGhFcIcLBZ8jCUhKiKHtJUprye1JKQghDztR1vW8bIQQx1BXN' +
  '6rr+ARSF875EhLcU0dcyIkKYpi63h4i4OI7ziHipmZkzMHPm3GYmJiaW1trqPp17nIhggd8hZjZ1z' +
  'dl3veo6R8S2bb1KqUvyvg8Avh5EhL8LzDz/bY3oAAAAAElFTkSuQmCC';

function showWindow(): void {
  if (!win) return;
  win.show();
  win.focus();
}

function hideToTray(): void {
  win?.hide();
  if (!hideNoticeShown && Notification.isSupported()) {
    hideNoticeShown = true;
    try {
      new Notification({
        title: 'TriBot 还在后台跑',
        body: 'Bot 继续干活。点托盘图标，或右键托盘 → 打开工作台，可以再回来。',
      }).show();
    } catch { /* 通知失败不影响 */ }
  }
}

function quitApp(): void {
  (app as any).isQuitting = true;
  app.quit();
}

function setupWindowIpc(): void {
  ipcMain.on('win:minimize', () => { if (!win) return; win.minimize(); });
  ipcMain.on('win:toggle-max', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  // X = 真正退出（此前是隐藏到托盘，看起来像没反应）；后台常驻改由托盘菜单「隐藏窗口」承担
  ipcMain.on('win:close', () => quitApp());
  ipcMain.handle('win:state', () => ({ maximized: win?.isMaximized() ?? false }));
  ipcMain.handle('dialog:pick-folder', async () => {
    const { dialog } = await import('electron');
    const r = await dialog.showOpenDialog(win ?? undefined as any, {
      title: '选择任务文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  // 读取本地文本文件作为对话附件（不经过 server，任何模型都能“看到”内容）
  ipcMain.handle('file:read-text', async () => {
    const { dialog } = await import('electron');
    const fs = await import('node:fs');
    const r = await dialog.showOpenDialog(win ?? undefined as any, {
      title: '选择要放进对话的文件',
      properties: ['openFile'],
      filters: [
        { name: '文本文件', extensions: ['md', 'txt', 'json', 'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'py', 'yml', 'yaml', 'toml', 'sql', 'log', 'csv'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    try {
      const stat = fs.statSync(file);
      if (stat.size > 512 * 1024) return { error: '文件超过 512KB，先裁剪再放进对话' };
      const content = fs.readFileSync(file, 'utf8');
      return { name: file.split(/[\\/]/).pop(), path: file, content };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  });
}
setupWindowIpc();

function createWindow(port: number): void {
  // 按屏幕工作区收窄窗口，避免窗口比屏幕大、右上角控制按钮跑到屏幕外
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440, wa.width - 80),
    height: Math.min(920, wa.height - 80),
    minWidth: 980,
    minHeight: 640,
    // 无边框：Windows 的浅色标题栏/边框会在暗色界面顶上留一条白边
    frame: false,
    backgroundColor: '#08080a',
    autoHideMenuBar: true,
    title: 'TriBot',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const url = process.env.TRIBOT_DEV_URL
    ? `${process.env.TRIBOT_DEV_URL}?port=${port}`
    : `file://${path.join(__dirname, 'renderer/index.html')}?port=${port}`;
  void win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    void shell.openExternal(u);
    return { action: 'deny' };
  });
  // 关窗 → 隐藏到托盘（Bot 继续干活）；托盘没建起来就直接退，避免留下看不见的进程
  win.on('close', (e) => {
    if ((app as any).isQuitting) return;
    if (!tray) return;
    e.preventDefault();
    hideToTray();
  });
  win.on('closed', () => { win = null; });
  win.on('maximize', () => win?.webContents.send('win:state-changed', { maximized: true }));
  win.on('unmaximize', () => win?.webContents.send('win:state-changed', { maximized: false }));
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createFromBuffer(Buffer.from(TRAY_PNG_BASE64, 'base64'));
  tray = new Tray(icon);
  tray.setToolTip('TriBot — Bot 团队工作台（双击显示）');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开工作台', click: () => showWindow() },
      { label: '隐藏窗口', click: () => win?.hide() },
      { type: 'separator' },
      { label: '退出 TriBot', click: () => quitApp() },
    ]),
  );
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else showWindow();
  });
  tray.on('double-click', () => showWindow());
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  showWindow();
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  try {
    const port = await ensurePort();
    createWindow(port);
    createTray();
  } catch (e) {
    console.error('[tribot] 启动失败：', e);
    const { dialog } = await import('electron');
    void dialog.showMessageBox({ type: 'error', message: 'TriBot 启动失败', detail: String(e) });
    app.quit();
  }
  app.on('activate', () => showWindow());
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
  serverProc?.kill();
});
app.on('window-all-closed', () => {
  // 常驻托盘，不退出（macOS 惯例同理）
});
