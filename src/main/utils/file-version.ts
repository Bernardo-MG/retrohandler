import type { Stats } from 'node:fs';

export function sameFile(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

export function sameVersion(first: Stats, second: Stats): boolean {
  return first.size === second.size && first.mtimeMs === second.mtimeMs;
}

/** Stronger in-process check; not a persistent fingerprint cache key. */
export function sameRegularFileVersion(first: Stats, second: Stats): boolean {
  return (
    first.isFile() &&
    second.isFile() &&
    sameFile(first, second) &&
    sameVersion(first, second) &&
    first.ctimeMs === second.ctimeMs
  );
}
