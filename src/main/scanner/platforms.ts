import path from 'node:path';

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

/** Classify files exactly as the v0.1 scanner does: first matching ancestor alias,
 * then extension hint, finally an explicitly unknown platform. This is an
 * inference, not positive identification of ROM contents. */
export function isCandidateRom(filename: string): boolean {
  return extensions.has(path.extname(filename).toLowerCase());
}

export function inferPlatform(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  const parts = relativePath.split(path.sep);
  return parts.slice(0, -1).map(p => aliases[normalize(p)]).find(Boolean)
    ?? extensionHints[extension] ?? 'Needs identification';
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
