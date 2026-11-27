import { BrowserWindow } from 'electron';
import type { SettingsStore } from '../../settings/settings-store';
import { bindWindowPreferences, initialWindowPreferences, windowBackground } from './window-preferences';
import { restrictNavigation, secureWebPreferences } from './window-security';
import { loadRenderer } from './renderer-loader';

export function createWindow(settings: SettingsStore): void {
  const { bounds, maximized } = initialWindowPreferences(settings);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(bounds.width, 880),
    minHeight: Math.min(bounds.height, 600),
    backgroundColor: windowBackground(),
    webPreferences: secureWebPreferences()
  });
  bindWindowPreferences(win, settings, maximized);
  restrictNavigation(win);
  void loadRenderer(win);
}
