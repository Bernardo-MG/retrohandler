import { app, BrowserWindow, nativeTheme, protocol } from 'electron';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { registerLibraryIpc } from './ipc/library-ipc';
import { registerIdentificationIpc } from './ipc/identification-ipc';
import { IdentificationService } from './identification';
import { DatReader } from './identification/dat/dat-reader';
import { ArchivedRomFingerprint, DirectRomFingerprint, RomFingerprintReader } from './identification/rom/rom-fingerprint-reader';
import { SevenZipReader } from './components/archives/seven-zip-reader';
import { FingerprintReader } from './components/hashing/fingerprint-reader';
import type { IdentificationRepository } from './contracts/persistence';
import { FileSystemLibraryService } from './services/library';
import { createWindow, verifyPackagedRenderer } from './app/window';
import { registerArtworkProtocol } from './app/artwork-protocol';
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

app.setName('RetroHandler');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.retrohandler.desktop');
}
protocol.registerSchemesAsPrivileged([{ scheme: 'retro-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function createIdentificationService(repository: IdentificationRepository): IdentificationService {
  const reader = new FingerprintReader();
  const fingerprints = new RomFingerprintReader([
    new DirectRomFingerprint(repository, reader),
    new ArchivedRomFingerprint(new SevenZipReader(), reader)
  ]);
  return new IdentificationService(repository, fingerprints, new DatReader());
}

/** One construction path for both the packaged smoke check and normal startup. */
function createCore(root: string) {
  const databasePath = path.join(root, 'library.sqlite');
  const database = openDatabase(databasePath);
  try {
    const collections = createCollectionRepository(database);
    const metadata = createMetadataRepository(database);
    const library = new FileSystemLibraryService({
      collections,
      roms: createRomRepository(database),
      systemOverrides: metadata
    });
    const settings = new SettingsStore(path.join(root, 'settings.json'));
    const artwork = new ArtworkCache(path.join(root, 'artwork'));
    registerLibraryIpc(library);
    registerIdentificationIpc(createIdentificationService(createIdentificationRepository(database)), library);
    registerSettingsIpc(settings, databasePath, artwork, metadata);
    return { database, library, metadata, settings, artwork };
  } catch (error) {
    database.close();
    throw error;
  }
}

function registerDesktopFeatures(core: ReturnType<typeof createCore>): void {
  const { database, library, metadata, artwork } = core;
  const http = new HttpClient();
  const catalogue = createLaunchBoxRepository(database);
  const metadataService = new MetadataService(metadata, new LaunchBoxProvider(catalogue));
  const launchBox = new LaunchBoxCatalogueUpdater(new LaunchBoxCatalogueImporter(catalogue), http);
  const libretro = new LibretroProvider(artwork, new LibretroClient(http));
  registerMetadataIpc({ metadata: metadataService, artwork: libretro, launchBox });
  registerExportIpc(new ExportService(library, new RetroPieExporter(artwork)));
  registerArtworkProtocol(artwork);
}

async function runPackageSmoke(root: string): Promise<void> {
  const core = createCore(root);
  try {
    await core.library.listCollections();
    await verifyPackagedRenderer();
  } finally {
    core.database.close();
  }
  app.exit(0);
}

function startDesktop(): void {
  const core = createCore(app.getPath('userData'));
  try {
    nativeTheme.themeSource = core.settings.snapshot().settings.appearance.theme;
    registerDesktopFeatures(core);
    createWindow(core.settings);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(core.settings);
      }
    });
    app.once('before-quit', () => core.database.close());
  } catch (error) {
    core.database.close();
    throw error;
  }
}

function focusExistingWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
}

function quitAfterLastWindow(): void {
  if (process.platform !== 'darwin') {
    app.quit();
  }
}

function failStartup(error: unknown): void {
  console.error(error);
  app.exit(1);
}

function preparePackageSmoke(): void {
  // Never open or migrate the real library during release verification.
  const temp = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-package-'));
  app.setPath('userData', temp);
  app.setPath('sessionData', temp);
  process.once('exit', () => {
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch { /* Windows may still hold Chromium files. */ }
  });
  app.whenReady().then(() => runPackageSmoke(temp)).catch(failStartup);
}

// A single instance owns settings and artwork cleanup.
if (app.isPackaged && process.argv.includes('--retrohandler-package-smoke')) {
  preparePackageSmoke();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);
  app.on('window-all-closed', quitAfterLastWindow);
  app.whenReady().then(startDesktop).catch(failStartup);
}
