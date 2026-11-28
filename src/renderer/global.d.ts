import type { DesktopApi } from '../shared';
declare global {
  interface Window {
    retrohandler: DesktopApi;
  }
}
export {};
