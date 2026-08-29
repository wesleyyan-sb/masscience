const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#0f1419',
    title: 'Masscience',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: true,
    },
  });

  const appRoot = path.join(__dirname, '..');
  const distIndex = path.join(appRoot, 'dist', 'web', 'index.html');
  const rootIndex = path.join(appRoot, 'index.html');
  const indexToLoad = fs.existsSync(distIndex) ? distIndex : rootIndex;

  win.loadFile(indexToLoad);
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
