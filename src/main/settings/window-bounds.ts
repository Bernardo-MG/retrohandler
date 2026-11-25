import type { WindowBounds } from '../../shared';

/** Restore a window on an available work area, including after a monitor is removed. */
export function restoreWindowBounds(saved: WindowBounds | null, areas: WindowBounds[], primary: WindowBounds): WindowBounds {
  const intersection = (a: WindowBounds, b: WindowBounds) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const matching = saved ? [...areas].sort((a,b) => intersection(saved,b) - intersection(saved,a))[0] : undefined;
  const area = matching && saved && intersection(saved,matching) > 0 ? matching : primary;
  const width = Math.min(area.width, Math.max(Math.min(880, area.width), saved?.width ?? 1280));
  const height = Math.min(area.height, Math.max(Math.min(600, area.height), saved?.height ?? 820));
  const visible = !!(matching && saved && intersection(saved,matching) > 0);
  const x = visible && saved ? Math.min(Math.max(saved.x, area.x), area.x + area.width - width) : area.x + Math.floor((area.width - width) / 2);
  const y = visible && saved ? Math.min(Math.max(saved.y, area.y), area.y + area.height - height) : area.y + Math.floor((area.height - height) / 2);
  return { x, y, width, height };
}
