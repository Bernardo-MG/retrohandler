// Explicit allowlist: no caller-controlled hosts or arbitrary URL paths.
const LIBRETRO_PLATFORM: Readonly<Record<string, string>> = {
  'Nintendo Entertainment System': 'Nintendo - Nintendo Entertainment System',
  'Super Nintendo': 'Nintendo - Super Nintendo Entertainment System',
  'Game Boy': 'Nintendo - Game Boy',
  'Game Boy Color': 'Nintendo - Game Boy Color',
  'Game Boy Advance': 'Nintendo - Game Boy Advance',
  'Nintendo 64': 'Nintendo - Nintendo 64',
  'Nintendo DS': 'Nintendo - Nintendo DS',
  'Mega Drive / Genesis': 'Sega - Mega Drive - Genesis',
  'Master System': 'Sega - Master System - Mark III',
  'Game Gear': 'Sega - Game Gear',
  'PlayStation': 'Sony - PlayStation',
  'PlayStation 2': 'Sony - PlayStation 2',
  'PlayStation Portable': 'Sony - PlayStation Portable',
  'Dreamcast': 'Sega - Dreamcast',
  'Sega Saturn': 'Sega - Saturn',
  'PC Engine / TurboGrafx-16': 'NEC - PC Engine - TurboGrafx 16',
  'Atari 2600': 'Atari - 2600',
  'Atari 7800': 'Atari - 7800',
  'Neo Geo': 'SNK - Neo Geo'
};
/** Accept user-edited system labels, scanner abbreviations and RetroPie folder names. */
const SYSTEM_ALIASES: Readonly<Record<string, string>> = {
  nes: 'Nintendo Entertainment System',
  famicom: 'Nintendo Entertainment System',
  snes: 'Super Nintendo',
  'super nintendo entertainment system': 'Super Nintendo',
  'super famicom': 'Super Nintendo',
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  gba: 'Game Boy Advance',
  n64: 'Nintendo 64',
  nds: 'Nintendo DS',
  genesis: 'Mega Drive / Genesis',
  megadrive: 'Mega Drive / Genesis',
  'sega genesis': 'Mega Drive / Genesis',
  'sega mega drive': 'Mega Drive / Genesis',
  sms: 'Master System',
  mastersystem: 'Master System',
  gg: 'Game Gear',
  gamegear: 'Game Gear',
  ps1: 'PlayStation',
  psx: 'PlayStation',
  ps2: 'PlayStation 2',
  psp: 'PlayStation Portable',
  dc: 'Dreamcast',
  saturn: 'Sega Saturn',
  pce: 'PC Engine / TurboGrafx-16',
  pcengine: 'PC Engine / TurboGrafx-16',
  tg16: 'PC Engine / TurboGrafx-16',
  neogeo: 'Neo Geo',
  atari2600: 'Atari 2600',
  atari7800: 'Atari 7800'
};
function systemKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

export function libretroPlatform(system: string): string | null {
  const key = systemKey(system);
  if (Object.prototype.hasOwnProperty.call(SYSTEM_ALIASES, key)) {
    return LIBRETRO_PLATFORM[SYSTEM_ALIASES[key]];
  }
  for (const [label, platform] of Object.entries(LIBRETRO_PLATFORM)) {
    if (systemKey(label) === key || systemKey(platform) === key) {
      return platform;
    }
  }
  return null;
}
