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
/** Accept user-edited system labels, scanner abbreviations and RetroPie folder names. */
const SYSTEM_ALIASES: Readonly<Record<string, string>> = {
  nes: 'Nintendo Entertainment System', famicom: 'Nintendo Entertainment System',
  snes: 'Super Nintendo', 'super nintendo entertainment system': 'Super Nintendo',
  'super famicom': 'Super Nintendo',
  gb: 'Game Boy', gbc: 'Game Boy Color', gba: 'Game Boy Advance',
  n64: 'Nintendo 64', nds: 'Nintendo DS',
  genesis: 'Mega Drive / Genesis', megadrive: 'Mega Drive / Genesis',
  'sega genesis': 'Mega Drive / Genesis', 'sega mega drive': 'Mega Drive / Genesis',
  sms: 'Master System', mastersystem: 'Master System',
  gg: 'Game Gear', gamegear: 'Game Gear',
  ps1: 'PlayStation', psx: 'PlayStation', ps2: 'PlayStation',
  psp: 'PlayStation Portable', dc: 'Dreamcast', saturn: 'Sega Saturn',
  pce: 'PC Engine / TurboGrafx-16', pcengine: 'PC Engine / TurboGrafx-16',
  tg16: 'PC Engine / TurboGrafx-16', neogeo: 'Neo Geo',
  atari2600: 'Atari 2600', atari7800: 'Atari 7800'
};
const systemKey = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
export function libretroPlatform(system: string): string | null {
  const key = systemKey(system);
  const canonical = SYSTEM_ALIASES[key] ||
    Object.keys(LIBRETRO_PLATFORM).find(name => systemKey(name) === key) ||
    Object.keys(LIBRETRO_PLATFORM).find(name => systemKey(LIBRETRO_PLATFORM[name]) === key);
  return canonical ? LIBRETRO_PLATFORM[canonical] : null;
}

/** Exact ROM/title first; only then a small number of common No-Intro region variants. */
export function libretroCandidates(names: string[]): string[] {
  const exact: string[] = [];
  const baseNames: string[] = [];
  const add = (array: string[], value: string) => {
    const safe = value.replace(/[&*\/<>:|?"\\]/g,'_').replace(/\s+/g,' ').trim();
    if (safe && safe.length <= 160 && !array.includes(safe)) array.push(safe);
  };
  for (const input of names) {
    const name = path.win32.basename(input.replace(/\//g,'\\'))
      .replace(/\.(nes|sfc|smc|gb|gbc|gba|n64|z64|v64|zip|7z|rar|cue|iso|chd)$/i,'').trim();
    add(exact, name);
    // Remove trailing No-Intro tags, never the actual game title or numbered sequel.
    const clean = name.replace(/(?:\s*[([](?:USA|Europe|Japan|World|Rev[^)\]]*|En[^)\]]*|Proto|Beta|USA, Europe|Europe, USA)[)\]])+$/gi,'').trim();
    if (clean !== name) add(baseNames, clean);
    else if (!/[([](?:USA|Europe|Japan|World)[)\]]/i.test(name)) add(baseNames, name);
  }
  const candidates = [...exact];
  // Region variants are tried before the bare title, but only after exact names.
  for (const base of baseNames) {
    for (const region of ['USA', 'Europe', 'Japan', 'USA, Europe', 'World']) add(candidates, `${base} (${region})`);
  }
  for (const base of baseNames) add(candidates, base);
  return candidates.slice(0, 24);
}
export async function findLibretroCover(system: string, names: string[], folder: string,
    request: typeof fetch = fetch): Promise<string | null> {
  const platform = libretroPlatform(system);
  if (!platform) throw new Error(`No Libretro artwork catalogue for system: ${system || '(unassigned)'}. Assign a supported system to the ROM first.`);
  for (const title of libretroCandidates(names)) {
    const response = await requestBoxart(platform, `${title}.png`, request);
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


/** A local, bounded preview of a genuine image from the selected Libretro platform. */
export interface LibretroCoverChoice { title: string; artworkId: string; }
const INDEX_TTL_MS = 60 * 60 * 1000;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_INDEX_ITEMS = 80000;
const indexCache = new Map<string, { expires: number; files: string[] }>();

/** Only accept filenames, never paths, schemes, query strings or encoded separators. */
function safeBoxartName(value: string): string | null {
  if (!value.toLowerCase().endsWith('.png') || value.length > 220 || /[/\\\0-\x1f]/.test(value) || value === '..' || value.includes('%')) return null;
  return value;
}

/** Libretro's .index is newline-delimited; some mirrors expose a directory listing instead. */
export function parseLibretroIndex(data: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const clean = safeBoxartName(name);
    if (clean && !seen.has(clean) && names.length < MAX_INDEX_ITEMS) { seen.add(clean); names.push(clean); }
  };
  if (/<(?:html|a)\b/i.test(data)) {
    for (const match of data.matchAll(/href\s*=\s*["']([^"']+\.png)["']/gi)) {
      try { add(decodeURIComponent(match[1].replace(/&amp;/g,'&'))); } catch { /* malformed link */ }
    }
  } else {
    for (const line of data.split(/\r?\n/)) {
      const name = line.trim();
      // Support both raw names and URL-escaped names in .index files.
      try { add(decodeURIComponent(name)); } catch { /* malformed entry */ }
    }
  }
  return names;
}

async function boundedText(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_INDEX_BYTES) throw new Error('Libretro artwork index exceeds 4 MiB.');
  if (!response.body) throw new Error('Libretro artwork index is empty.');
  const chunks: Buffer[] = [];
  let count = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); count += bytes.length;
    if (count > MAX_INDEX_BYTES) throw new Error('Libretro artwork index exceeds 4 MiB.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function githubRepo(platform: string): string {
  return encodeURIComponent(platform.replace(/ /g, '_'));
}

async function githubBoxartIndex(platform: string, request: typeof fetch): Promise<string[]> {
  const base = `https://api.github.com/repos/libretro-thumbnails/${githubRepo(platform)}/git/trees/`;
  const loadTree = async (ref: string) => {
    const response = await request(base + encodeURIComponent(ref), {
      redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Retrohandler' }
    });
    if (!response.ok) throw new Error(`GitHub tree HTTP ${response.status}.`);
    const data = JSON.parse(await boundedText(response));
    if (data.truncated || !Array.isArray(data.tree)) throw new Error('GitHub artwork tree is incomplete.');
    return data.tree as { path: string; type: string; sha: string }[];
  };
  const root = await loadTree('master');
  const boxarts = root.find(entry => entry.path === 'Named_Boxarts' && entry.type === 'tree');
  if (!boxarts || !/^[a-f0-9]{40}$/i.test(boxarts.sha)) throw new Error('GitHub Named_Boxarts tree not found.');
  const entries = await loadTree(boxarts.sha);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.type !== 'blob' || typeof entry.path !== 'string') continue;
    const name = safeBoxartName(entry.path);
    if (name) files.push(name);
    if (files.length >= MAX_INDEX_ITEMS) break;
  }
  return files;
}

async function requestBoxart(platform: string, filename: string, request: typeof fetch): Promise<Response> {
  const suffix = `Named_Boxarts/${encodeURIComponent(filename)}`;
  const options = () => ({ redirect: 'error' as const, signal: AbortSignal.timeout(12000) });
  try {
    const response = await request(`https://thumbnails.libretro.com/${encodeURIComponent(platform)}/${suffix}`, options());
    if (response.ok) return response;
    await response.body?.cancel();
  } catch { /* try the official GitHub mirror */ }
  return request(`https://raw.githubusercontent.com/libretro-thumbnails/${githubRepo(platform)}/master/${suffix}`, options());
}

async function boxartIndex(platform: string, request: typeof fetch, refresh: boolean): Promise<string[]> {
  const cached = indexCache.get(platform);
  if (!refresh && cached && cached.expires > Date.now()) return cached.files;
  const base = `https://thumbnails.libretro.com/${encodeURIComponent(platform)}/Named_Boxarts/`;
  let files: string[] = [];
  const errors: string[] = [];
  for (const relative of ['.index', '']) {
    try {
      const response = await request(base + relative, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      files = parseLibretroIndex(await boundedText(response));
      if (files.length) break;
      throw new Error('empty catalogue');
    } catch (error) { errors.push(`${relative || 'directory listing'}: ${String(error)}`); }
  }
  if (!files.length) {
    try { files = await githubBoxartIndex(platform, request); }
    catch (error) { errors.push(`GitHub: ${String(error)}`); }
  }
  if (!files.length) throw new Error(`Libretro artwork catalogue unavailable for ${platform} (${errors.join('; ') || 'empty catalogue'}).`);
  indexCache.set(platform, { expires: Date.now() + INDEX_TTL_MS, files });
  return files;
}

const cleanSearch = (name: string) => path.win32.basename(name.replace(/\//g,'\\'))
  .replace(/\.(nes|sfc|smc|gb|gbc|gba|n64|z64|v64|zip|7z|rar|cue|iso|chd)$/i,'')
  .replace(/(?:\s*[([][^)\]]+[)\]])+$/g, '').trim();
const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const region = (name: string): string | null => {
  if (/\b(?:Europe|EU)\b/i.test(name)) return 'europe';
  if (/\b(?:USA|US)\b/i.test(name)) return 'usa';
  if (/\b(?:Japan|JP)\b/i.test(name)) return 'japan';
  return null;
};
/** Strong title matching is mandatory; region is only a ranking hint. */
export function matchLibretroBoxarts(files: string[], query: string, regionHint = ''): string[] {
  const needle = normalized(cleanSearch(query));
  if (needle.length < 2) return [];
  const wantedRegion = region(regionHint || query);
  return files.map(file => {
    const title = file.slice(0,-4);
    const base = normalized(cleanSearch(title));
    // Do not match Alien 3 against Alien 3D, Alien 2 or a different game series.
    const exact = base === needle;
    const partial = !exact && base.startsWith(needle + ' ');
    const starts = !exact && !partial && needle.length >= 4 && base.includes(' ' + needle + ' ');
    if (!exact && !partial && !starts) return null;
    const score = (exact ? 100 : partial ? 60 : 30) + (wantedRegion && region(title) === wantedRegion ? 20 : 0);
    return {file,score};
  }).filter((result): result is {file:string;score:number} => result !== null)
    .sort((a,b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0,32).map(result => result.file);
}

/** Downloads a few genuine candidates into the existing trusted local artwork cache. */
export async function searchLibretroCovers(system: string, query: string, regionHint: string, folder: string,
    refresh = false, request: typeof fetch = fetch): Promise<LibretroCoverChoice[]> {
  const platform = libretroPlatform(system);
  if (!platform) throw new Error(`No Libretro artwork catalogue for system: ${system || '(unassigned)'}.`);
  if (!query.trim() || query.length > 120) throw new Error('Enter a game title to search for box art.');
  const files = await boxartIndex(platform, request, refresh);
  const matches = matchLibretroBoxarts(files, query, regionHint);
  const results: LibretroCoverChoice[] = [];
  for (const filename of matches) {
    if (results.length >= 8) break;
    const response = await requestBoxart(platform, filename, request);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Libretro image HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length'));
    if (length > 5*1024*1024) continue;
    if (!response.body) continue;
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 5*1024*1024) break;
      parts.push(bytes);
    }
    if (size > 5*1024*1024) continue;
    try {
      const artworkId = await cacheArtworkBytes(Buffer.concat(parts), folder);
      results.push({title:filename.slice(0,-4),artworkId});
    } catch { /* a listed entry may be broken; continue with valid images */ }
  }
  return results;
}
