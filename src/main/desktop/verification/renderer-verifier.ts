import { BrowserWindow } from 'electron';
import { secureWebPreferences } from '../window/window-security';
import { loadPackagedRenderer } from '../window/renderer-loader';

/** Verify the packaged preload and renderer without opening a normal window. */
export async function verifyPackagedRenderer(): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: secureWebPreferences()
  });
  try {
    await loadPackagedRenderer(win);
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
