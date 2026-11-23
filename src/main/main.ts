import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerLibraryIpc } from './ipc/library-ipc';
import { FileSystemLibraryService } from './services/library/library-service';
import { SqliteLibraryStore } from './database/library-store';

app.setName('RetroHandler');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 880, minHeight: 600,
    backgroundColor: '#0d111b',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  // Development URLs must never override the packaged renderer.
  const devUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
  if (devUrl && /^http:\/\/127\.0\.0\.1:5173\/?$/.test(devUrl)) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  const store = new SqliteLibraryStore(path.join(app.getPath('userData'), 'library.sqlite'));
  registerLibraryIpc(new FileSystemLibraryService(store));
  app.once('before-quit', () => store.close());
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
