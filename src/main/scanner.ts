import { opendir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Rom, ScanResult } from '../shared';
import { inferPlatform, isCandidateRom } from './scanner/platforms';
import { titleFromName } from './scanner/naming';

/** Legacy-compatible read-only inventory scanner. It does not hash ROM content,
 * inspect archive members, or identify multi-file disc sets. */
export async function scanRoms(folder: string): Promise<ScanResult> {
  const root = await realpath(folder);
  if (!(await lstat(root)).isDirectory()) throw new Error('Please choose a directory.');
  const games: Rom[] = [];
  let ignored = 0;
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const MAX_FILES = 250_000;
  while (pending.length) {
    const next = pending.pop()!;
    const dir = await opendir(next.dir);
    for await (const entry of dir) {
      if (entry.isSymbolicLink()) continue; // never follow symlinks outside the selected tree
      const fullPath = path.join(next.dir, entry.name);
      if (entry.isDirectory()) {
        if (next.depth < 15 && !entry.name.startsWith('.')) pending.push({ dir: fullPath, depth: next.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!isCandidateRom(entry.name)) { ignored++; continue; }
      // Disc .bin files alongside .cue files are intentionally left visible for the first release.
      const relativePath = path.relative(root, fullPath);
      const system = inferPlatform(relativePath);
      const stats = await lstat(fullPath);
      games.push({
        id: createHash('sha256').update(relativePath).digest('hex').slice(0, 16),
        name: titleFromName(entry.name), system, relativePath, extension, bytes: stats.size
      });
      if (games.length >= MAX_FILES) throw new Error(`Scan limit (${MAX_FILES.toLocaleString()} files) reached. Select a smaller collection.`);
    }
  }
  games.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));
  return { source: root, games, ignored, scannedAt: new Date().toISOString() };
}
