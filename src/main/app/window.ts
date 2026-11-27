import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import path from 'node:path';
import type { SettingsStore } from '../settings/settings-store';
import { restoreWindowBounds } from '../settings/window-bounds';

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, '../../preload/preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true
  };
}

function packagedRendererPath(): string {
  return path.join(__dirname, '../../../dist/index.html');
}

export function createWindow(settings: SettingsStore): void {
  const saved = settings.snapshot().settings.window;
  const bounds = restoreWindowBounds(
    saved.bounds,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea
  );
  const win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(bounds.width, 880),
    minHeight: Math.min(bounds.height, 600),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d111b' : '#f4f6fa',
    webPreferences: secureWebPreferences()
  });
  if (saved.maximized) {
    win.maximize();
  }
  const updateBackground = () =>
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0d111b' : '#f4f6fa');
  nativeTheme.on('updated', updateBackground);
  win.on('close', () => {
    try {
      settings.saveWindow({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    } catch (error) {
      console.error('Could not save window preferences:', error);
    }
  });
  win.once('closed', () => nativeTheme.removeListener('updated', updateBackground));
  // Development URLs must never override the packaged renderer.
  const devUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
  if (devUrl && /^http:\/\/127\.0\.0\.1:5173\/?$/.test(devUrl)) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(packagedRendererPath());
  }
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/** Verify the packaged preload and renderer without opening a normal window. */
export async function verifyPackagedRenderer(): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: secureWebPreferences()
  });
  try {
    await win.loadFile(packagedRendererPath());
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
  }
}
