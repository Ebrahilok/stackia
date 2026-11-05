'use strict';
const { app, BrowserWindow, Menu, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const RETRY_MS = 3000;

function hostUrl() {
  if (process.env.STACKIA_URL) return process.env.STACKIA_URL;
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'client.json'), 'utf8')).url;
}

function offlinePage(url) {
  const body = `<body style="background:#241b20;color:#fad696;font:18px monospace;display:grid;place-items:center;height:100vh;margin:0">
    <div>Conectando con Stack IA en ${url}…</div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(body)}`;
}

function createWindow() {
  const url = hostUrl();
  const { origin } = new URL(url);
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    backgroundColor: '#241b20',
    title: 'Stack IA',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const { webContents } = win;
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== origin) event.preventDefault();
  });
  webContents.on('did-fail-load', (_event, _code, _text, _failed, isMainFrame) => {
    if (!isMainFrame) return;
    win.loadURL(offlinePage(url));
    setTimeout(() => { if (!win.isDestroyed()) win.loadURL(url); }, RETRY_MS);
  });
  win.loadURL(url);
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const win = createWindow();
  globalShortcut.register('F11', () => win.setFullScreen(!win.isFullScreen()));
  globalShortcut.register('CommandOrControl+R', () => win.reload());
});
app.on('window-all-closed', () => app.quit());
