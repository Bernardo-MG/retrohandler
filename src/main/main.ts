import { app, BrowserWindow, nativeTheme, protocol, screen } from 'electron';
import path from 'node:path';
import { registerLibraryIpc } from './ipc/library-ipc';
import { FileSystemLibraryService } from './services/library/library-service';
import { SqliteLibraryStore } from './database/library-store';
import { registerMetadataIpc } from './metadata/metadata-ipc';
import { getArtwork, isArtworkId } from './metadata/artwork';
import { registerExportIpc } from './export/export-ipc';
import { SettingsStore } from './settings/settings-store';
import { registerSettingsIpc } from './settings/settings-ipc';
import { restoreWindowBounds } from './settings/window-bounds';

app.setName('RetroHandler');
protocol.registerSchemesAsPrivileged([{ scheme: 'retro-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function createWindow(settings: SettingsStore) {
  const saved = settings.snapshot().settings.window;
  const bounds = restoreWindowBounds(saved.bounds, screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea);
  const win = new BrowserWindow({
    ...bounds, minWidth: Math.min(bounds.width, 880), minHeight: Math.min(bounds.height, 600),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d111b' : '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  if (saved.maximized) win.maximize();
  const updateBackground = () => win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0d111b' : '#f4f6fa');
  nativeTheme.on('updated', updateBackground);
  win.on('close', () => {
    try { settings.saveWindow({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }); }
    catch (error) { console.error('Could not save window preferences:', error); }
  });
  win.once('closed', () => nativeTheme.removeListener('updated', updateBackground));
  // Development URLs must never override the packaged renderer.
  const devUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
  if (devUrl && /^http:\/\/127\.0\.0\.1:5173\/?$/.test(devUrl)) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// A single instance owns the settings file and artwork cleanup, preventing two
// independent main processes from racing to update the same preferences/cache.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(() => {
    const databasePath = path.join(app.getPath('userData'), 'library.sqlite');
    const store = new SqliteLibraryStore(databasePath);
    const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    nativeTheme.themeSource = settings.snapshot().settings.appearance.theme;
    registerLibraryIpc(new FileSystemLibraryService(store));
    const artworkFolder = path.join(app.getPath('userData'), 'artwork');
    registerMetadataIpc(store, artworkFolder);
    registerSettingsIpc(settings, databasePath, artworkFolder);
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
    createWindow(settings);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(settings); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
