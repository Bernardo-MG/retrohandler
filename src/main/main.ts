import { app, BrowserWindow, protocol } from 'electron';
import path from 'node:path';
import { registerLibraryIpc } from './ipc/library-ipc';
import { FileSystemLibraryService } from './services/library/library-service';
import { SqliteLibraryStore } from './database/library-store';
import { registerMetadataIpc } from './metadata/metadata-ipc';
import { getArtwork, isArtworkId } from './metadata/artwork';
import { registerExportIpc } from './export/export-ipc';

app.setName('RetroHandler');
protocol.registerSchemesAsPrivileged([{ scheme: 'retro-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

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
  const artworkFolder = path.join(app.getPath('userData'), 'artwork');
  registerMetadataIpc(store, artworkFolder);
  registerExportIpc(new FileSystemLibraryService(store), artworkFolder);
  protocol.handle('retro-art', async request => {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.slice(1));
      if (url.hostname !== 'cover' || !isArtworkId(id) || url.search || url.hash) return new Response('Not found', { status: 404 });
      const art = await getArtwork(artworkFolder, id);
      return new Response(new Uint8Array(art.body), { headers: { 'Content-Type': art.mime, 'Cache-Control': 'private, max-age=86400' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  app.once('before-quit', () => store.close());
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
