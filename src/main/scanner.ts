import { opendir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Rom, ScanResult } from '../shared';

const aliases: Record<string, string> = {
  nes: 'Nintendo Entertainment System', famicom: 'Nintendo Entertainment System',
  snes: 'Super Nintendo', sfc: 'Super Nintendo',
  gb: 'Game Boy', gbc: 'Game Boy Color', gba: 'Game Boy Advance',
  n64: 'Nintendo 64', nintendo64: 'Nintendo 64', nds: 'Nintendo DS',
  megadrive: 'Mega Drive / Genesis', genesis: 'Mega Drive / Genesis',
  mastersystem: 'Master System', sms: 'Master System', gg: 'Game Gear',
  psx: 'PlayStation', ps1: 'PlayStation', ps2: 'PlayStation 2',
  psp: 'PlayStation Portable', dreamcast: 'Dreamcast', dc: 'Dreamcast',
  saturn: 'Sega Saturn', arcade: 'Arcade', mame: 'Arcade', fba: 'Arcade',
  neogeo: 'Neo Geo', pcengine: 'PC Engine / TurboGrafx-16',
  atari2600: 'Atari 2600', atari7800: 'Atari 7800',
  ports: 'Ports', dos: 'DOS', scummvm: 'ScummVM',
};
const extensions = new Set([
  '.zip', '.7z', '.nes', '.fds', '.sfc', '.smc', '.gb', '.gbc', '.gba', '.n64', '.z64', '.v64',
  '.nds', '.md', '.gen', '.smd', '.sms', '.gg', '.cue', '.chd', '.iso', '.cso', '.pbp',
  '.gdi', '.cdi', '.bin', '.a26', '.a78', '.pce', '.ngp', '.ngc', '.ws', '.wsc', '.rom', '.wad'
]);
const extensionHints: Record<string, string> = {
  '.nes': 'Nintendo Entertainment System', '.fds': 'Nintendo Entertainment System',
  '.sfc': 'Super Nintendo', '.smc': 'Super Nintendo', '.gb': 'Game Boy',
  '.gbc': 'Game Boy Color', '.gba': 'Game Boy Advance', '.n64': 'Nintendo 64',
  '.z64': 'Nintendo 64', '.v64': 'Nintendo 64', '.nds': 'Nintendo DS',
  '.md': 'Mega Drive / Genesis', '.gen': 'Mega Drive / Genesis', '.smd': 'Mega Drive / Genesis',
  '.sms': 'Master System', '.gg': 'Game Gear', '.a26': 'Atari 2600',
  '.a78': 'Atari 7800', '.pce': 'PC Engine / TurboGrafx-16',
  '.pbp': 'PlayStation', '.cso': 'PlayStation Portable',
};
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function titleFromName(filename: string): string {
  return path.parse(filename).name.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/[._]+/g, ' ').trim();
}

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
      if (!extensions.has(extension)) { ignored++; continue; }
      // Disc .bin files alongside .cue files are intentionally left visible for the first release.
      const relativePath = path.relative(root, fullPath);
      const parts = relativePath.split(path.sep);
      const system = parts.slice(0, -1).map(p => aliases[normalize(p)]).find(Boolean)
        ?? extensionHints[extension] ?? 'Needs identification';
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
