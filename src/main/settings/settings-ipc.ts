import { BrowserWindow, dialog, ipcMain, nativeTheme, screen } from 'electron';
import type { CacheCleanupReceipt, StorageInfo } from '../../shared';
import type { ArtworkReferences } from '../contracts/persistence';
import { cleanupArtworkCache, inspectArtworkCache } from './artwork-cache';
import { SettingsStore } from './settings-store';
import { restoreWindowBounds } from './window-bounds';

export function registerSettingsIpc(
  store: SettingsStore,
  databasePath: string,
  artworkPath: string,
  artworkReferences: ArtworkReferences
): void {
  const storageInfo = (): StorageInfo => ({
    databasePath,
    settingsPath: store.filePath,
    artworkPath,
    ...inspectArtworkCache(artworkPath, artworkReferences.getReferencedArtworkIds())
  });
  ipcMain.handle('settings:get', () => store.snapshot());
  ipcMain.handle(
    'settings:save',
    (_event, raw: unknown) => {
      const settings = store.update(raw);
      nativeTheme.themeSource = settings.appearance.theme;
      return settings;
    }
  );
  ipcMain.handle(
    'settings:reset',
    event => {
      const settings = store.reset();
      nativeTheme.themeSource = settings.appearance.theme;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window && !window.isDestroyed()) {
        if (window.isMaximized()) {
          window.unmaximize();
        }
        window.setBounds(restoreWindowBounds(
          null,
          screen.getAllDisplays().map(display => display.workArea),
          screen.getPrimaryDisplay().workArea
        ));
      }
      return settings;
    }
  );
  ipcMain.handle('settings:storage', () => storageInfo());
  let cleaning = false;
  ipcMain.handle(
    'settings:cleanup-artwork',
    async (): Promise<CacheCleanupReceipt> => {
      if (cleaning) {
        throw new Error('Artwork cleanup is already running.');
      }
      cleaning = true;
      try {
        const info = storageInfo();
        if (!info.reclaimableFiles) {
          return { removedFiles: 0, removedBytes: 0, failedFiles: 0 };
        }
        const confirmation = await dialog.showMessageBox({
          type: 'warning',
          title: 'Clean artwork cache',
          message: `Remove unused artwork and abandoned downloads?`,
          detail: `${info.reclaimableFiles} files are currently eligible. Artwork referenced by the library, artwork less than seven days old, and unrelated files are retained. This does not delete ROMs, metadata, or the database.`,
          buttons: ['Cancel', 'Remove unused files'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        });
        if (confirmation.response !== 1) {
          return { removedFiles: 0, removedBytes: 0, failedFiles: 0 };
        }
        // Refresh artwork references after confirmation, and do not yield between reference check and deletion.
        return cleanupArtworkCache(artworkPath, artworkReferences.getReferencedArtworkIds());
      } finally {
        cleaning = false;
      }
    }
  );
}
