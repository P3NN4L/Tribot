import { contextBridge, ipcRenderer } from 'electron';

// 渲染层通过 HTTP/SSE 访问本地 server（端口经 URL query 传入），preload 只做环境标记 + 窗口控制
contextBridge.exposeInMainWorld('tribot', {
  isElectron: true,
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-max'),
    close: () => ipcRenderer.send('win:close'),
    getState: () => ipcRenderer.invoke('win:state') as Promise<{ maximized: boolean }>,
    onStateChange: (cb: (s: { maximized: boolean }) => void) => {
      const handler = (_e: unknown, s: { maximized: boolean }) => cb(s);
      ipcRenderer.on('win:state-changed', handler);
      return () => ipcRenderer.removeListener('win:state-changed', handler);
    },
  },
  chooseFolder: () => ipcRenderer.invoke('dialog:pick-folder') as Promise<string | null>,
  readLocalFile: () => ipcRenderer.invoke('file:read-text') as Promise<
    { name: string; path: string; content: string } | { error: string } | null
  >,
});
