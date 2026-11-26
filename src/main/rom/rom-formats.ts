// A compressed container or disc image is not the underlying ROM.
const ARCHIVES = new Set(['.zip', '.rar', '.7z']);
const DIRECT_ROMS = new Set([
  '.nes', '.fds', '.sfc', '.smc', '.gb', '.gbc', '.gba', '.n64', '.z64', '.v64', '.nds',
  '.md', '.gen', '.smd', '.sms', '.gg', '.a26', '.a78', '.pce', '.ngp', '.ngc', '.ws', '.wsc', '.rom'
]);
// These files belong in the inventory but cannot be directly fingerprinted as a ROM.
const OTHER_SCANNABLE_ROMS = new Set([
  '.cue', '.gdi', '.chd', '.iso', '.cso', '.pbp', '.cdi', '.bin', '.wad'
]);

export function isRomArchive(extension: string): boolean {
  return ARCHIVES.has(extension.toLowerCase());
}

export function isDirectRom(extension: string): boolean {
  return DIRECT_ROMS.has(extension.toLowerCase());
}

export function isScannableRom(extension: string): boolean {
  return isDirectRom(extension) || isRomArchive(extension) || OTHER_SCANNABLE_ROMS.has(extension.toLowerCase());
}
