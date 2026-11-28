import { nativeTheme, screen, type BrowserWindow } from 'electron';
import type { SettingsStore } from '../../settings/settings-store';
import { restoreWindowBounds } from '../../settings/window-bounds';

export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0d111b' : '#f4f6fa';
}

export function initialWindowPreferences(settings: SettingsStore) {
  const saved = settings.snapshot().settings.window;
  const bounds = restoreWindowBounds(
    saved.bounds,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea
  );
  return { bounds, maximized: saved.maximized };
}

export function bindWindowPreferences(win: BrowserWindow, settings: SettingsStore, maximized: boolean): void {
  if (maximized) {
    win.maximize();
  }
  const updateBackground = () => win.setBackgroundColor(windowBackground());
  nativeTheme.on('updated', updateBackground);
  win.on('close', () => {
    try {
      settings.saveWindow({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    } catch (error) {
      console.error('Could not save window preferences:', error);
    }
  });
  win.once('closed', () => nativeTheme.removeListener('updated', updateBackground));
}
