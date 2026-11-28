import path from 'node:path';

/** Produce a readable provisional title without claiming a database match. */
export function titleFromName(filename: string): string {
  return path
    .parse(filename)
    .name.replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/[._]+/g, ' ')
    .trim();
}
