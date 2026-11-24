import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RETROPIE_SYSTEM_MAP, type ExportOptions, type ExportPlan, type ExportFile, type LibraryEntry, type LibraryQuery, type LibraryPage } from '../../shared';
import { artworkPath, isArtworkId } from '../metadata/artwork';

// RetroPie ROM directory names; unknown platforms require an explicit override.
const SYSTEM_MAP = RETROPIE_SYSTEM_MAP;

export type ExportLibrary = { queryLibrary(query: LibraryQuery): Promise<LibraryPage> };
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const childOf = (parent: string, child: string) => {
  const rel = path.relative(parent, child);
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
const overlaps = (a: string, b: string) => a === b || childOf(a, b) || childOf(b, a);
const validSystem = (s: string) => /^[a-z0-9][a-z0-9_-]{0,49}$/.test(s) && !['con','prn','nul','aux'].includes(s);
const knownSystem = (name: string) => Object.prototype.hasOwnProperty.call(SYSTEM_MAP, name) ? SYSTEM_MAP[name] : undefined;
const filenameOf = (relative: string): string => path.win32.basename(relative.replace(/\//g, '\\'));
function formatDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === s ? s.replace(/-/g, '') + 'T000000' : null;
}

export function gameListXml(games: Array<{ entry: LibraryEntry; filename: string; image: string | null }>): string {
  const elements = games.map(({ entry, filename, image }) => {
    const m = entry.metadata;
    const props = [
      ['path', `./${filename}`], ['name', m?.title?.trim() || entry.identifiedTitle || entry.name],
      ['desc', m?.description], ['image', image ? `./images/${image}` : null],
      ['releasedate', formatDate(m?.released || '')], ['developer', m?.developer],
      ['publisher', m?.publisher], ['genre', m?.genre]
    ].filter((pair): pair is [string, string] => !!pair[1]);
    return '  <game>\n' + props.map(([k,v]) => `    <${k}>${xmlEscape(v)}</${k}>`).join('\n') + '\n  </game>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gameList>\n' + elements.join('\n') + '\n</gameList>\n';
}

async function collect(library: ExportLibrary, source: string | null): Promise<LibraryEntry[]> {
  const all: LibraryEntry[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await library.queryLibrary({ source, search: '', system: null, sort: 'name', descending: false, offset, limit: 200 });
    all.push(...page.items);
    if (all.length >= page.total) return all;
    if (!page.items.length || all.length > 250000) throw new Error('Library changed during export preview.');
  }
}

export async function previewExport(library: ExportLibrary, options: ExportOptions, artworkFolder: string): Promise<ExportPlan> {
  if (!path.isAbsolute(options.destination) || !options.destination.trim()) throw new Error('Choose an absolute destination folder.');
  if (options.source !== null && (!path.isAbsolute(options.source) || options.source.length > 4096)) throw new Error('Invalid collection.');
  if (typeof options.includeArtwork !== 'boolean' || !options.overrides || Array.isArray(options.overrides) || typeof options.overrides !== 'object') throw new Error('Invalid export options.');
  const entries = await collect(library, options.source);
  const dest = path.resolve(options.destination);
  const roots = [...new Set(entries.map(e => path.resolve(e.source)))];
  // Protect sources even if the selected collection happens to have zero indexed files.
  if (options.source) roots.push(path.resolve(options.source));
  for (const root of roots) if (overlaps(root.toLowerCase(), dest.toLowerCase())) throw new Error('Export destination overlaps a ROM collection.');
  const parentReal = await realpath(path.dirname(dest)).catch(() => null);
  if (parentReal) for (const root of roots) {
    const realRoot = await realpath(root).catch(() => root);
    if (overlaps(realRoot.toLowerCase(), path.join(parentReal, path.basename(dest)).toLowerCase())) throw new Error('Export destination overlaps a ROM collection.');
  }
  const files: ExportFile[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const bySystem = new Map<string, Array<{ entry: LibraryEntry; filename: string; image: string | null }>>();
  let bytes = 0;
  for (const entry of entries) {
    const mapped = Object.prototype.hasOwnProperty.call(options.overrides, entry.system) ? options.overrides[entry.system] : knownSystem(entry.system);
    if (!mapped || !validSystem(mapped)) { warnings.push(`Unmapped system: ${entry.system}`); continue; }
    const fileName = filenameOf(entry.relativePath);
    if (!fileName || fileName === '.' || fileName === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(fileName) || /[. ]$/.test(fileName)) {
      warnings.push(`Unsupported filename: ${entry.relativePath}`); continue;
    }
    if (['.rar', '.7z'].includes(path.extname(fileName).toLowerCase())) { warnings.push(`RetroPie emulator compatibility not established for ${entry.relativePath}; convert to a supported format first.`); continue; }
    const src = path.resolve(entry.source, entry.relativePath);
    if (!childOf(path.resolve(entry.source), src)) { warnings.push(`Unsafe source: ${entry.relativePath}`); continue; }
    const dstRelative = `roms/${mapped}/${fileName}`;
    const key = dstRelative.toLowerCase();
    if (seen.has(key)) { warnings.push(`Filename collision: ${dstRelative}`); continue; }
    seen.add(key);
    const st = await lstat(src).catch(() => null);
    if (!st?.isFile()) { warnings.push(`Unavailable or linked source: ${entry.relativePath}`); continue; }
    const realSource = await realpath(src).catch(() => '');
    const realRoot = await realpath(entry.source).catch(() => '');
    if (!childOf(realRoot, realSource)) { warnings.push(`Source escapes collection: ${entry.relativePath}`); continue; }
    const file: ExportFile = { source: src, relativeDestination: dstRelative, size: st.size, kind: 'rom' };
    // A ROM entry is a gamelist reference only: it is never copied to the destination.
    files.push(file);
    let image: string | null = null;
    const id = entry.metadata?.artworkId;
    if (options.includeArtwork && isArtworkId(id)) {
      const imageDest = `roms/${mapped}/images/${id}`;
      const imageKey = imageDest.toLowerCase();
      const cached = artworkPath(artworkFolder, id);
      const artInfo = await lstat(cached).catch(() => null);
      if (artInfo?.isFile() && artInfo.size <= 5*1024*1024) {
        image = id;
        if (!seen.has(imageKey)) {
          files.push({ source: cached, relativeDestination: imageDest, size: artInfo.size, kind: 'artwork' });
          bytes += artInfo.size; seen.add(imageKey);
        }
      } else warnings.push(`Cached artwork unavailable: ${id}`);
    }
    const group = bySystem.get(mapped) ?? [];
    group.push({ entry, filename: fileName, image });
    bySystem.set(mapped, group);
  }
  for (const [system, group] of bySystem) {
    files.push({ source: '', relativeDestination: `roms/${system}/gamelist.xml`, size: Buffer.byteLength(gameListXml(group)), kind: 'gamelist' });
  }
  // No existing destination file may be overwritten, including XML and cached art.
  const conflicts: string[] = [];
  for (const item of files) {
    // Existing ROMs are expected: config-only exports never write or replace them.
    if (item.kind === 'rom') continue;
    const target = path.join(dest, ...item.relativeDestination.split('/'));
    if (!childOf(dest, target)) throw new Error('Invalid export destination path.');
    const exists = await lstat(target).then(() => true, () => false);
    if (exists) conflicts.push(item.relativeDestination);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ destination: dest, files, warnings, conflicts, options })).digest('hex');
  return { destination: dest, files, systems: [...bySystem.keys()].sort(), warnings, conflicts, bytes, fingerprint };
}

export async function executeExport(library: ExportLibrary, options: ExportOptions, artworkFolder: string, approvedFingerprint: string): Promise<{ copied: number }> {
  const plan = await previewExport(library, options, artworkFolder);
  if (plan.fingerprint !== approvedFingerprint) throw new Error('Export preview changed; preview again.');
  if (plan.conflicts.length) throw new Error('Resolve destination conflicts before export.');
  if (!plan.files.some(file => file.kind === 'rom')) throw new Error('No exportable ROMs in preview.');
  // Never write into an existing symlinked destination directory.
  await mkdir(plan.destination, { recursive: true });
  const canonical = await realpath(plan.destination);
  if (path.normalize(canonical).toLowerCase() !== path.normalize(plan.destination).toLowerCase()) throw new Error('Export destination uses a redirected directory.');
  // Build gamelists only from ROMs approved by the preview. Excluded entries
  // (unmapped systems, unsafe paths, duplicate filenames, unsupported archives)
  // must never appear as dangling paths in gamelist.xml.
  const approvedRoms = new Map(plan.files.filter(file => file.kind === 'rom')
    .map(file => [file.relativeDestination.toLowerCase(), file.source]));
  const approvedArtwork = new Set(plan.files.filter(file => file.kind === 'artwork')
    .map(file => file.relativeDestination.toLowerCase()));
  const entries = await collect(library, options.source);
  const gameGroups = new Map<string, Array<{ entry: LibraryEntry; filename: string; image: string | null }>>();
  for (const entry of entries) {
    const system = Object.prototype.hasOwnProperty.call(options.overrides, entry.system)
      ? options.overrides[entry.system] : knownSystem(entry.system);
    if (!system || !validSystem(system)) continue;
    const filename = filenameOf(entry.relativePath);
    const destination = `roms/${system}/${filename}`;
    const key = destination.toLowerCase();
    if (approvedRoms.get(key) !== path.resolve(entry.source, entry.relativePath)) continue;
    approvedRoms.delete(key); // Only one game entry per approved destination.
    const artworkId = entry.metadata?.artworkId;
    const image = options.includeArtwork && isArtworkId(artworkId) &&
      approvedArtwork.has(`roms/${system}/images/${artworkId}`.toLowerCase()) ? artworkId : null;
    const group = gameGroups.get(system) ?? [];
    group.push({ entry, filename, image });
    gameGroups.set(system, group);
  }
  if (approvedRoms.size) throw new Error('Library changed during export; preview again.');
  let copied = 0;
  for (const item of plan.files) {
    // The preview includes ROM references to build gamelist.xml, not ROM copy jobs.
    if (item.kind === 'rom') continue;
    const target = path.join(plan.destination, ...item.relativeDestination.split('/'));
    const folder = path.dirname(target);
    await mkdir(folder, { recursive: true });
    if (path.normalize(await realpath(folder)).toLowerCase() !== path.normalize(folder).toLowerCase()) throw new Error('Export directory redirected.');
    if (item.kind === 'gamelist') {
      const system = item.relativeDestination.split('/')[1];
      await writeFile(target, gameListXml(gameGroups.get(system) ?? []), {flag: 'wx'});
    } else {
      const st = await lstat(item.source);
      if (!st.isFile() || st.size !== item.size) throw new Error(`Source changed: ${item.source}`);
      await copyFile(item.source, target, constants.COPYFILE_EXCL);
    }
    copied++;
  }
  return { copied };
}
