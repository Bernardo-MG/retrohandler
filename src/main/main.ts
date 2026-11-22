import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { scanRoms } from './scanner';

app.setName('RetroHandler');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 880, minHeight: 600,
    backgroundColor: '#0d111b',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(path.join(__dirname, '../../dist/index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('roms:choose-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('roms:scan', async (_event, folder: unknown) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Invalid folder.');
    return scanRoms(folder);
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
