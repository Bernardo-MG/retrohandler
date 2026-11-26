import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  RETROPIE_SYSTEM_MAP,
  type ExportOptions,
  type ExportPlan,
  type ExportFile,
  type ExportReceipt,
  type LibraryEntry,
  type LibraryQuery,
  type LibraryPage
} from '../../shared';
import { artworkPath, isArtworkId } from '../metadata/artwork';
import { hasInvalidXmlChars, xmlEscape } from '../components/xml/xml-text';
import { mergeGameLists } from './gamelist-merge';
import { assertSafeDirectory, childOf, ensureSafeDirectory, overlaps } from '../components/filesystem/paths';
import { readRegular } from '../components/filesystem/file-reader';
import { replaceWithBackup, writeExclusive } from '../components/filesystem/file-writer';

// RetroPie ROM directory names; unknown platforms require an explicit override.
const SYSTEM_MAP = RETROPIE_SYSTEM_MAP;

export type ExportLibrary = {
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>
};
const validSystem = (s: string) => /^[a-z0-9][a-z0-9_-]{0,49}$/.test(s) && !['con', 'prn', 'nul', 'aux'].includes(s);
const knownSystem = (name: string) => Object.prototype.hasOwnProperty.call(SYSTEM_MAP, name) ? SYSTEM_MAP[name] : undefined;
const filenameOf = (relative: string): string => path.win32.basename(relative.replace(/\//g, '\\'));
function formatDate(s: string): string | null {
  // EmulationStation requires a full timestamp, but metadata can contain a
  // year or a year-month when the exact release day is unknown.
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2] ?? '01');
  const day = Number(match[3] ?? '01');
  if (year < 1 || month < 1 || month > 12) {
    return null;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) {
    return null;
  }
  return `${match[1]}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T000000`;
}

export function gameListXml(games: Array<{
  entry: LibraryEntry;
  filename: string;
  image: string | null
}>): string {
  const elements = games.map(({ entry, filename, image }) => {
    const m = entry.metadata;
    const props = [
      ['path', `./${filename}`],
      ['name', m?.title?.trim() || entry.identifiedTitle?.trim() || entry.name],
      ['desc', m?.description],
      ['image', image ? `./images/${image}` : null],
      ['releasedate', formatDate(m?.released || '')],
      ['developer', m?.developer],
      ['publisher', m?.publisher],
      ['genre', m?.genre]
    ].filter((pair): pair is [string, string] => !!pair[1]?.trim());
    return '  <game>\n' + props.map(([k, v]) => `    <${k}>${xmlEscape(v)}</${k}>`).join('\n') + '\n  </game>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gameList>\n' + elements.join('\n') + '\n</gameList>\n';
}

async function collect(library: ExportLibrary, source: string | null): Promise<LibraryEntry[]> {
  const all: LibraryEntry[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await library.queryLibrary({
      source,
      search: '',
      system: null,
      sort: 'name',
      descending: false,
      offset,
      limit: 200
    });
    all.push(...page.items);
    if (all.length >= page.total) {
      return all;
    }
    if (!page.items.length || all.length > 250000) {
      throw new Error('Library changed during export preview.');
    }
  }
}

const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_ART_BYTES = 5 * 1024 * 1024;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hashOrNull = (bytes: Buffer | null) => bytes === null ? null : hash(bytes);
const targetPath = (root: string, relative: string) => path.join(root, ...relative.split('/'));

type ExportJob = {
  previous: string | null;
  output: string;
  xml?: Buffer
};
async function prepareExport(library: ExportLibrary, options: ExportOptions, artworkFolder: string): Promise<{
  plan: ExportPlan;
  jobs: Map<string, ExportJob>
}> {
  if (!path.isAbsolute(options.destination) || !options.destination.trim()) {
    throw new Error('Choose an absolute destination folder.');
  }
  if (options.source !== null && (!path.isAbsolute(options.source) || options.source.length > 4096)) {
    throw new Error('Invalid collection.');
  }
  if (typeof options.includeArtwork !== 'boolean' || !options.overrides || Array.isArray(options.overrides) || typeof options.overrides !== 'object') {
    throw new Error('Invalid export options.');
  }
  const entries = await collect(library, options.source);
  const dest = path.resolve(options.destination);
  await assertSafeDirectory(dest);
  const roots = [...new Set(entries.map(e => path.resolve(e.source)))];
  // Protect sources even if the selected collection happens to have zero indexed files.
  if (options.source) {
    roots.push(path.resolve(options.source));
  }
  for (const root of roots) if (overlaps(root.toLowerCase(), dest.toLowerCase())) {
    throw new Error('Export destination overlaps a ROM collection.');
  }
  // The destination has no redirected ancestors. Also protect canonical source
  // roots, even if the requested destination parent does not exist yet.
  for (const root of roots) {
    const realRoot = await realpath(root).catch(() => root);
    if (overlaps(realRoot.toLowerCase(), dest.toLowerCase())) {
      throw new Error('Export destination overlaps a ROM collection.');
    }
  }
  const files: ExportFile[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const bySystem = new Map<string, Array<{
    entry: LibraryEntry;
    filename: string;
    image: string | null
  }>>();
  for (const entry of entries) {
    const mapped = Object.prototype.hasOwnProperty.call(options.overrides, entry.system) ? options.overrides[entry.system] : knownSystem(entry.system);
    if (!mapped || !validSystem(mapped)) {
      warnings.push(`Unmapped system: ${entry.system}`);
      continue;
    }
    const fileName = filenameOf(entry.relativePath);
    if (!fileName || fileName === '.' || fileName === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(fileName) || /[. ]$/.test(fileName) || hasInvalidXmlChars(fileName)) {
      warnings.push(`Unsupported filename: ${entry.relativePath}`);
      continue;
    }
    if (['.rar', '.7z'].includes(path.extname(fileName).toLowerCase())) {
      warnings.push(`RetroPie emulator compatibility not established for ${entry.relativePath}; convert to a supported format first.`);
      continue;
    }
    const src = path.resolve(entry.source, entry.relativePath);
    if (!childOf(path.resolve(entry.source), src)) {
      warnings.push(`Unsafe source: ${entry.relativePath}`);
      continue;
    }
    const dstRelative = `roms/${mapped}/${fileName}`;
    const key = dstRelative.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Filename collision: ${dstRelative}`);
      continue;
    }
    const st = await lstat(src).catch(() => null);
    if (!st?.isFile()) {
      warnings.push(`Unavailable or linked source: ${entry.relativePath}`);
      continue;
    }
    const realSource = await realpath(src).catch(() => '');
    const realRoot = await realpath(entry.source).catch(() => '');
    if (!realRoot || !realSource || !childOf(realRoot, realSource)) {
      warnings.push(`Source escapes collection: ${entry.relativePath}`);
      continue;
    }
    seen.add(key);
    const file: ExportFile = {
      source: src,
      relativeDestination: dstRelative,
      size: st.size,
      kind: 'rom'
    };
    // A ROM entry is a gamelist reference only: it is never copied to the destination.
    files.push(file);
    let image: string | null = null;
    const id = entry.metadata?.artworkId;
    if (options.includeArtwork && isArtworkId(id)) {
      const imageDest = `roms/${mapped}/images/${id}`;
      const imageKey = imageDest.toLowerCase();
      const cached = artworkPath(artworkFolder, id);
      const artInfo = await lstat(cached).catch(() => null);
      if (artInfo?.isFile() && artInfo.size <= 5 * 1024 * 1024) {
        image = id;
        if (!seen.has(imageKey)) {
          files.push({
            source: cached,
            relativeDestination: imageDest,
            size: artInfo.size,
            kind: 'artwork'
          });
          seen.add(imageKey);
        }
      } else {
        warnings.push(`Cached artwork unavailable: ${id}`);
      }
    }
    const group = bySystem.get(mapped) ?? [];
    group.push({ entry, filename: fileName, image });
    bySystem.set(mapped, group);
  }
  const jobs = new Map<string, ExportJob>();
  const conflicts: string[] = [];
  // Existing artwork can be reused only when it is byte-identical. Never
  // overwrite a different image, even if its filename looks content-addressed.
  let bytes = 0;
  for (const item of files) {
    if (item.kind !== 'artwork') {
      continue;
    }
    const target = targetPath(dest, item.relativeDestination);
    try {
      if (!childOf(dest, target)) {
        throw new Error('Invalid export destination path.');
      }
      await assertSafeDirectory(path.dirname(target));
      const source = await readRegular(item.source, MAX_ART_BYTES);
      if (!source || source.length !== item.size) {
        throw new Error('Cached artwork changed; preview again.');
      }
      const prior = await readRegular(target, MAX_ART_BYTES);
      const output = hash(source);
      const previous = hashOrNull(prior);
      if (previous !== null && previous !== output) {
        throw new Error('Existing artwork differs from cached artwork.');
      }
      item.action = prior === null ? 'create' : 'reuse';
      jobs.set(item.relativeDestination, { previous, output });
      if (item.action === 'create') {
        bytes += item.size;
      }
    } catch (error) {
      conflicts.push(`${item.relativeDestination}: ${String(error)}`);
    }
  }
  for (const [system, group] of bySystem) {
    const relativeDestination = `roms/${system}/gamelist.xml`;
    const item: ExportFile = {
      source: '',
      relativeDestination,
      size: 0,
      kind: 'gamelist'
    };
    files.push(item);
    try {
      const target = targetPath(dest, relativeDestination);
      if (!childOf(dest, target)) {
        throw new Error('Invalid export destination path.');
      }
      await assertSafeDirectory(path.dirname(target));
      const prior = await readRegular(target, MAX_XML_BYTES);
      const generated = gameListXml(group);
      const fallbackNames = new Set(group.filter(g => !g.entry.metadata?.title?.trim() && !g.entry.identifiedTitle?.trim()).map(g => g.filename));
      const xml = Buffer.from(
        prior === null ? generated : mergeGameLists(
          new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(prior),
          generated,
          system,
          fallbackNames
        ),
        'utf8'
      );
      if (xml.length > MAX_XML_BYTES) {
        throw new Error('Merged gamelist exceeds 32 MiB.');
      }
      const previous = hashOrNull(prior);
      const output = hash(xml);
      item.size = xml.length;
      item.action = prior === null ? 'create' : previous === output ? 'reuse' : 'update';
      jobs.set(relativeDestination, { previous, output, xml });
    } catch (error) {
      conflicts.push(`${relativeDestination}: ${String(error)}`);
    }
  }
  // Hash actual generated metadata, source images and destination contents, not
  // just sizes. A same-length edit must invalidate an approved preview too.
  const versions = [...jobs].map(([relative, job]) => [relative, job.previous, job.output]);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    destination: dest,
    files,
    warnings,
    conflicts,
    options,
    versions
  })).digest('hex');
  const skippedRoms = entries.length - files.filter(file => file.kind === 'rom').length;
  return {
    plan: {
      destination: dest,
      files,
      systems: [...bySystem.keys()].sort(),
      warnings,
      conflicts,
      bytes,
      fingerprint,
      skippedRoms
    },
    jobs
  };
}

export async function previewExport(library: ExportLibrary, options: ExportOptions, artworkFolder: string): Promise<ExportPlan> {
  return (await prepareExport(library, options, artworkFolder)).plan;
}

let exporting = false;
export async function executeExport(
  library: ExportLibrary,
  options: ExportOptions,
  artworkFolder: string,
  approvedFingerprint: string
): Promise<ExportReceipt> {
  if (exporting) {
    throw new Error('Another configuration export is running.');
  }
  exporting = true;
  try {
    const { plan, jobs } = await prepareExport(library, options, artworkFolder);
    if (plan.fingerprint !== approvedFingerprint) {
      throw new Error('Export preview changed; preview again.');
    }
    if (plan.conflicts.length) {
      throw new Error('Resolve destination conflicts before export.');
    }
    if (!plan.files.some(file => file.kind === 'rom')) {
      throw new Error('No exportable ROMs in preview.');
    }
    let copied = 0;
    const backups: string[] = [];
    // Artwork jobs precede XML jobs so we never publish a new image reference
    // before the corresponding artwork has been written or verified.
    try {
      for (const item of plan.files) {
        if (item.kind === 'rom') {
          continue;
        } // ROMs are references only.
        const job = jobs.get(item.relativeDestination);
        if (!job) {
          throw new Error('Export job missing; preview again.');
        }
        const target = targetPath(plan.destination, item.relativeDestination);
        await ensureSafeDirectory(path.dirname(target));
        const max = item.kind === 'gamelist' ? MAX_XML_BYTES : MAX_ART_BYTES;
        const prior = await readRegular(target, max);
        if (hashOrNull(prior) !== job.previous) {
          throw new Error(`Destination changed; preview again: ${item.relativeDestination}`);
        }
        const content = item.kind === 'gamelist' ? job.xml : await readRegular(item.source, MAX_ART_BYTES);
        if (!content || hash(content) !== job.output) {
          throw new Error(`Source changed; preview again: ${item.relativeDestination}`);
        }
        if (item.action === 'reuse') {
          continue;
        }
        if (item.action === 'create') {
          await writeExclusive(target, content);
        } else if (item.kind === 'gamelist' && item.action === 'update' && prior !== null) {
          await replaceWithBackup(target, content, prior, max, 'retrohandler', backup => {
            backups.push(path.relative(plan.destination, backup).split(path.sep).join('/'));
          });
        } else {
          throw new Error('Invalid export job.');
        }
        copied++;
      }
    } catch (error) {
      if (copied || backups.length) {
        throw new Error(`Export stopped after ${copied} XML/artwork file(s) written. Backups: ${backups.join(', ') || 'none'}. Preview again before retrying. ${String(error)}`);
      }
      throw error;
    }
    return backups.length ? { copied, backups } : { copied };
  } finally {
    exporting = false;
  }
}
