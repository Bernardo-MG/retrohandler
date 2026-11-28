import path from 'node:path';

/** Paths are relative to dist-electron/main/desktop/window. */
export function preloadPath(directory: string): string {
  return path.join(directory, '../../../preload/preload.js');
}

export function packagedRendererPath(directory: string): string {
  return path.join(directory, '../../../../dist/index.html');
}

export function developmentRendererUrl(isPackaged: boolean, url: string | undefined): string | undefined {
  return !isPackaged && url && /^http:\/\/127\.0\.0\.1:5173\/?$/.test(url) ? url : undefined;
}
