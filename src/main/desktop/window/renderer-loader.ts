import { app, type BrowserWindow } from 'electron';
import { developmentRendererUrl, packagedRendererPath } from './renderer-paths';

export function loadRenderer(win: BrowserWindow): Promise<void> {
  const devUrl = developmentRendererUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL);
  return devUrl ? win.loadURL(devUrl) : win.loadFile(packagedRendererPath(__dirname));
}

export function loadPackagedRenderer(win: BrowserWindow): Promise<void> {
  return win.loadFile(packagedRendererPath(__dirname));
}
