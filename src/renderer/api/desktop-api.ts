import type { DesktopApi } from '../../shared';

/** The renderer's only entry point to the preload bridge. Resolve lazily for tests. */
export function desktopApi(): DesktopApi {
  return window.retrohandler;
}
