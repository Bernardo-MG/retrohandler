import { readFile, stat } from 'node:fs/promises';

export interface DatEntry { game: string; file: string; size: number; crc32: string | null; md5: string | null; sha1: string | null; }
export interface ParsedDat { name: string; entries: DatEntry[]; }
const MAX_DAT_BYTES = 64 * 1024 * 1024;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (raw, ref: string) => {
    if (ref[0] !== '#') return entities[ref.toLowerCase()] ?? raw;
    const number = ref[1].toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isInteger(number) && number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : raw;
  });
}
function attributes(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
  return result;
}
function digest(value: string | undefined, length: number): string | null {
  return value && new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(value) ? value.toLowerCase() : null;
}
/** Deliberately restricted Logiqx XML DAT reader; rejects DTD/entities and unsupported formats.
 * DAT files are local imports, not executable content. */
export function parseDat(xml: string): ParsedDat {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entity declarations are unsupported.');
  if (!/<datafile(?:\s|>)/i.test(xml)) throw new Error('Expected Logiqx XML DAT (<datafile>).');
  const header = /<header\b[^>]*>([\s\S]*?)<\/header\s*>/i.exec(xml)?.[1] ?? '';
  const name = decode(/<name\s*>([\s\S]*?)<\/name\s*>/i.exec(header)?.[1]?.trim() ?? 'Imported DAT');
  const entries: DatEntry[] = [];
  for (const gameMatch of xml.matchAll(/<(game|machine)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const gameName = attributes(gameMatch[2]).name;
    if (!gameName) continue;
    for (const romMatch of gameMatch[3].matchAll(/<rom\b([^>]*?)\s*\/?>/gi)) {
      const fields = attributes(romMatch[1]);
      const size = Number(fields.size);
      if (!fields.name || !fields.size || !Number.isSafeInteger(size) || size < 0) continue;
      const crc32 = digest(fields.crc, 8), md5 = digest(fields.md5, 32), sha1 = digest(fields.sha1, 40);
      if (!crc32 && !md5 && !sha1) continue;
      entries.push({ game: gameName, file: fields.name, size, crc32, md5, sha1 });
    }
  }
  if (!entries.length) throw new Error('No supported ROM hashes found in DAT.');
  return { name: name.slice(0, 250), entries };
}
export async function readDat(file: string): Promise<ParsedDat> {
  const info = await stat(file);
  if (info.size > MAX_DAT_BYTES) throw new Error('DAT exceeds 64 MiB import limit.');
  return parseDat(await readFile(file, 'utf8'));
}
