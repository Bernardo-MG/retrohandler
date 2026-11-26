import { app, BrowserWindow, nativeTheme, protocol, screen } from 'electron';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { registerLibraryIpc } from './ipc/library-ipc';
import { FileSystemLibraryService } from './services/library/library-service';
import {
  openDatabase,
  createCollectionRepository,
  createRomRepository,
  createIdentificationRepository,
  createMetadataRepository,
  createLaunchBoxRepository
} from './database';
import { registerMetadataIpc } from './ipc/metadata-ipc';
import { ArtworkCache } from './components/artwork/artwork-cache';
import { isArtworkId } from './components/artwork/artwork-image';
import { HttpClient } from './components/http/http-client';
import { MetadataService } from './metadata';
import { LaunchBoxCatalogueImporter } from './metadata/launchbox/launchbox-catalogue-importer';
import { LaunchBoxCatalogueUpdater } from './metadata/launchbox/launchbox-catalogue-updater';
import { LaunchBoxProvider } from './metadata/launchbox/launchbox-provider';
import { LibretroClient } from './metadata/libretro/libretro-client';
import { LibretroProvider } from './metadata/libretro/libretro-provider';
import { registerExportIpc } from './ipc/export-ipc';
import { ExportService } from './export';
import { RetroPieExporter } from './export/retropie/retropie-exporter';
import { SettingsStore } from './settings/settings-store';
import { registerSettingsIpc } from './settings/settings-ipc';
import { restoreWindowBounds } from './settings/window-bounds';

app.setName('RetroHandler');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.retrohandler.desktop');
}
protocol.registerSchemesAsPrivileged([{ scheme: 'retro-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function createWindow(settings: SettingsStore) {
  const saved = settings.snapshot().settings.window;
  const bounds = restoreWindowBounds(
    saved.bounds,
    screen.getAllDisplays().map(display => display.workArea),
    screen.getPrimaryDisplay().workArea
  );
  const win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(bounds.width, 880),
    minHeight: Math.min(bounds.height, 600),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d111b' : '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  if (saved.maximized) {
    win.maximize();
  }
  const updateBackground = () => win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0d111b' : '#f4f6fa');
  nativeTheme.on('updated', updateBackground);
  win.on(
    'close',
    () => {
      try {
        settings.saveWindow({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
      }
      catch (error) {
        console.error('Could not save window preferences:', error);
      }
    }
  );
  win.once('closed', () => nativeTheme.removeListener('updated', updateBackground));
  // Development URLs must never override the packaged renderer.
  const devUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
  if (devUrl && /^http:\/\/127\.0\.0\.1:5173\/?$/.test(devUrl)) {
    void win.loadURL(devUrl);
  }
  else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// A single instance owns the settings file and artwork cleanup, preventing two
// independent main processes from racing to update the same preferences/cache.
if (app.isPackaged && process.argv.includes('--retrohandler-package-smoke')) {
  // Never open or migrate the real library during release verification.
  const temp = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-package-'));
  app.setPath('userData', temp);
  app.setPath('sessionData', temp);
  app.whenReady().then(async () => {
    const databasePath = path.join(temp, 'library.sqlite');
    const database = openDatabase(databasePath);
    const collections = createCollectionRepository(database);
    const metadata = createMetadataRepository(database);
    const library = new FileSystemLibraryService({
      collections,
      roms: createRomRepository(database),
      identification: createIdentificationRepository(database),
      systemOverrides: metadata
    });
    const settings = new SettingsStore(path.join(temp, 'settings.json'));
    const artwork = new ArtworkCache(path.join(temp, 'artwork'));
    registerLibraryIpc(library);
    registerSettingsIpc(settings, databasePath, artwork, metadata);
    collections.listCollections();
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    try {
      await win.loadFile(path.join(__dirname, '../../dist/index.html'));
      const ready = await win.webContents.executeJavaScript(`new Promise(resolve => {
        let attempts = 0;
        const timer = setInterval(() => {
          if (typeof window.retrohandler?.listCollections === 'function' && document.getElementById('root')?.firstElementChild) {
            clearInterval(timer); resolve(true);
          } else if (++attempts >= 100) { clearInterval(timer); resolve(false); }
        }, 100);
      })`);
      if (!ready) {
        throw new Error('Packaged renderer or preload did not initialize.');
      }
    } finally {
      win.destroy();
      database.close();
    }
    app.exit(0);
  }).catch(error => {
    console.error(error);
    app.exit(1);
  });
  process.once(
    'exit',
    () => {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch { /* Windows may still hold Chromium files. */ }
    }
  );
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on(
    'second-instance',
    () => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) {
        return;
      }
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  );
  app.whenReady().then(() => {
    const databasePath = path.join(app.getPath('userData'), 'library.sqlite');
    const database = openDatabase(databasePath);
    const collections = createCollectionRepository(database);
    const metadata = createMetadataRepository(database);
    const library = new FileSystemLibraryService({
      collections,
      roms: createRomRepository(database),
      identification: createIdentificationRepository(database),
      systemOverrides: metadata
    });
    const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    nativeTheme.themeSource = settings.snapshot().settings.appearance.theme;
    registerLibraryIpc(library);
    const artwork = new ArtworkCache(path.join(app.getPath('userData'), 'artwork'));
    const http = new HttpClient();
    const catalogue = createLaunchBoxRepository(database);
    const metadataService = new MetadataService(metadata, new LaunchBoxProvider(catalogue));
    const launchBox = new LaunchBoxCatalogueUpdater(new LaunchBoxCatalogueImporter(catalogue), http);
    const libretro = new LibretroProvider(artwork, new LibretroClient(http));
    registerMetadataIpc({ metadata: metadataService, artwork: libretro, launchBox });
    registerSettingsIpc(settings, databasePath, artwork, metadata);
    const exportService = new ExportService(library, new RetroPieExporter(artwork));
    registerExportIpc(exportService);
    protocol.handle(
      'retro-art',
      async request => {
        try {
          const url = new URL(request.url);
          const id = decodeURIComponent(url.pathname.slice(1));
          if (url.hostname !== 'cover' || !isArtworkId(id) || url.search || url.hash) {
            return new Response('Not found', { status: 404 });
          }
          const art = await artwork.read(id);
          return new Response(
            new Uint8Array(art.body),
            { headers: { 'Content-Type': art.mime, 'Cache-Control': 'private, max-age=86400' } }
          );
        } catch {
          return new Response('Not found', { status: 404 });
        }
      }
    );
    app.once('before-quit', () => database.close());
    createWindow(settings);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(settings);
      }
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
