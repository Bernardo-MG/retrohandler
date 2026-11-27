import path from 'node:path';

const aliases: Record<string, string> = {
  nes: 'Nintendo Entertainment System',
  famicom: 'Nintendo Entertainment System',
  snes: 'Super Nintendo',
  sfc: 'Super Nintendo',
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  gba: 'Game Boy Advance',
  n64: 'Nintendo 64',
  nintendo64: 'Nintendo 64',
  nds: 'Nintendo DS',
  megadrive: 'Mega Drive / Genesis',
  genesis: 'Mega Drive / Genesis',
  mastersystem: 'Master System',
  sms: 'Master System',
  gg: 'Game Gear',
  psx: 'PlayStation',
  ps1: 'PlayStation',
  ps2: 'PlayStation 2',
  psp: 'PlayStation Portable',
  dreamcast: 'Dreamcast',
  dc: 'Dreamcast',
  saturn: 'Sega Saturn',
  arcade: 'Arcade',
  mame: 'Arcade',
  fba: 'Arcade',
  neogeo: 'Neo Geo',
  pcengine: 'PC Engine / TurboGrafx-16',
  atari2600: 'Atari 2600',
  atari7800: 'Atari 7800',
  ports: 'Ports',
  dos: 'DOS',
  scummvm: 'ScummVM'
};
const extensionHints: Record<string, string> = {
  '.nes': 'Nintendo Entertainment System',
  '.fds': 'Nintendo Entertainment System',
  '.sfc': 'Super Nintendo',
  '.smc': 'Super Nintendo',
  '.gb': 'Game Boy',
  '.gbc': 'Game Boy Color',
  '.gba': 'Game Boy Advance',
  '.n64': 'Nintendo 64',
  '.z64': 'Nintendo 64',
  '.v64': 'Nintendo 64',
  '.nds': 'Nintendo DS',
  '.md': 'Mega Drive / Genesis',
  '.gen': 'Mega Drive / Genesis',
  '.smd': 'Mega Drive / Genesis',
  '.sms': 'Master System',
  '.gg': 'Game Gear',
  '.a26': 'Atari 2600',
  '.a78': 'Atari 7800',
  '.pce': 'PC Engine / TurboGrafx-16',
  '.pbp': 'PlayStation',
  '.cso': 'PlayStation Portable'
};

/** Infer the platform from ancestor aliases before file extensions; this is not ROM identification. */
export function inferPlatform(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  const ancestor = ancestorPlatform(relativePath);
  return ancestor ?? extensionHints[extension] ?? 'Needs identification';
}

function ancestorPlatform(relativePath: string): string | undefined {
  for (const part of relativePath.split(path.sep).slice(0, -1)) {
    const key = normalize(part);
    if (Object.hasOwn(aliases, key)) {
      return aliases[key];
    }
  }
  return undefined;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
