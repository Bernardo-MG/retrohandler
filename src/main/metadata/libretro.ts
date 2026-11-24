import path from 'node:path';
import { cacheArtworkBytes } from './artwork';

// Explicit allowlist: no caller-controlled hosts or arbitrary URL paths.
export const LIBRETRO_PLATFORM: Readonly<Record<string,string>> = {
  'Nintendo Entertainment System':'Nintendo - Nintendo Entertainment System',
  'Super Nintendo':'Nintendo - Super Nintendo Entertainment System',
  'Game Boy':'Nintendo - Game Boy', 'Game Boy Color':'Nintendo - Game Boy Color',
  'Game Boy Advance':'Nintendo - Game Boy Advance', 'Nintendo 64':'Nintendo - Nintendo 64',
  'Nintendo DS':'Nintendo - Nintendo DS', 'Mega Drive / Genesis':'Sega - Mega Drive - Genesis',
  'Master System':'Sega - Master System - Mark III', 'Game Gear':'Sega - Game Gear',
  'PlayStation':'Sony - PlayStation','PlayStation 2':'Sony - PlayStation 2',
  'PlayStation Portable':'Sony - PlayStation Portable',
  'Dreamcast':'Sega - Dreamcast','Sega Saturn':'Sega - Saturn',
  'PC Engine / TurboGrafx-16':'NEC - PC Engine - TurboGrafx 16',
  'Atari 2600':'Atari - 2600','Atari 7800':'Atari - 7800',
  'Neo Geo':'SNK - Neo Geo'
};
export function libretroCandidates(names: string[]): string[] {
  const found: string[] = [];
  for (const input of names) {
    const name = path.win32.basename(input.replace(/\//g,'\\')).replace(/\.(nes|sfc|smc|gb|gbc|gba|n64|z64|v64|zip|7z|rar|cue|iso|chd)$/i,'').trim();
    const cleaned = name.replace(/\s*[([](?:USA|Europe|Japan|World|Rev[^)\]]*|En[^)\]]*|Proto|Beta)[)\]]/gi,'').trim();
    for (const candidate of [name, cleaned]) {
      const safe = candidate.replace(/[&*\/<>:|?"\\]/g,'_').replace(/\s+/g,' ').trim();
      if (safe && safe.length <= 160 && !found.includes(safe)) found.push(safe);
    }
  }
  return found.slice(0,6);
}
export async function findLibretroCover(system: string, names: string[], folder: string,
    request: typeof fetch = fetch): Promise<string | null> {
  const platform = LIBRETRO_PLATFORM[system];
  if (!platform) throw new Error('No Libretro artwork catalogue for this system.');
  for (const title of libretroCandidates(names)) {
    const url = `https://thumbnails.libretro.com/${encodeURIComponent(platform)}/Named_Boxarts/${encodeURIComponent(title)}.png`;
    const response = await request(url, {redirect:'error',signal:AbortSignal.timeout(12000)});
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Libretro artwork HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length'));
    if (length > 5*1024*1024) throw new Error('Libretro artwork exceeds size limit.');
    if (!response.body) throw new Error('Libretro artwork has no image data.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 5*1024*1024) throw new Error('Libretro artwork exceeds size limit.');
      chunks.push(bytes);
    }
    return cacheArtworkBytes(Buffer.concat(chunks),folder);
  }
  return null;
}
