import { app, BrowserWindow, nativeTheme } from 'electron';
import { createCore, registerDesktopFeatures } from './composition';
import { createWindow } from './window/window-manager';
import { preparePackageSmoke } from './verification/package-smoke';
import { registerArtworkScheme } from './protocols/artwork-protocol';

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

export function startApplication(): void {
  app.setName('RetroHandler');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.retrohandler.desktop');
  }
  registerArtworkScheme();

  // A single instance owns settings and artwork cleanup.
  if (app.isPackaged && process.argv.includes('--retrohandler-package-smoke')) {
    preparePackageSmoke(failStartup);
  } else if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', focusExistingWindow);
    app.on('window-all-closed', quitAfterLastWindow);
    app.whenReady().then(startDesktop).catch(failStartup);
  }
}
