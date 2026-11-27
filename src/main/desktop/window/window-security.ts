import type { BrowserWindow } from 'electron';
import { preloadPath } from './renderer-paths';

export function secureWebPreferences() {
  return {
    preload: preloadPath(__dirname),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true
  };
}

export function restrictNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
