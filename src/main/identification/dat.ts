import { open } from 'node:fs/promises';

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
  const result: Record<string, string> = Object.create(null);
  for (const match of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
  return result;
}
function digest(value: string | undefined, length: number): string | null {
  return value && new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(value) ? value.toLowerCase() : null;
}
/** Deliberately restricted Logiqx XML DAT reader; rejects DTD/entities and unsupported formats.
 * DAT files are local imports, not executable content. */
export function parseDat(xml: string): ParsedDat {
  // Comments and CDATA are not markup. Mask them before looking for ROM records.
  xml = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');
  if (/<!--|<!\[CDATA\[/.test(xml)) throw new Error('Incomplete XML comment or CDATA.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entity declarations are unsupported.');
  if (!/<datafile(?:\s|>)/i.test(xml)) throw new Error('Expected Logiqx XML DAT (<datafile>).');
  if (!/<\/datafile\s*>\s*$/i.test(xml)) throw new Error('Incomplete Logiqx XML DAT.');
  const header = /<header\b[^>]*>([\s\S]*?)<\/header\s*>/i.exec(xml)?.[1] ?? '';
  const name = decode(/<name\s*>([\s\S]*?)<\/name\s*>/i.exec(header)?.[1]?.trim() ?? 'Imported DAT');
  const entries: DatEntry[] = [];
  for (const gameMatch of xml.matchAll(/<(game|machine)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const gameName = attributes(gameMatch[2]).name;
    if (!gameName) continue;
    for (const romMatch of gameMatch[3].matchAll(/<rom\b([^>]*?)\s*\/?>/gi)) {
      const fields = attributes(romMatch[1]);
      const size = Number(fields.size);
      if (!fields.name || !/^[0-9]+$/.test(fields.size ?? '') || !Number.isSafeInteger(size) || size < 0) continue;
      const crc32 = digest(fields.crc, 8), md5 = digest(fields.md5, 32), sha1 = digest(fields.sha1, 40);
      if (!crc32 && !md5 && !sha1) continue;
      entries.push({ game: gameName, file: fields.name, size, crc32, md5, sha1 });
    }
  }
  if (!entries.length) throw new Error('No supported ROM hashes found in DAT.');
  return { name: name.slice(0, 250), entries };
}
export async function readDat(file: string): Promise<ParsedDat> {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('DAT must be a regular file.');
    if (info.size > MAX_DAT_BYTES) throw new Error('DAT exceeds 64 MiB import limit.');
    // Bound the actual read even if the file grows after stat().
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_DAT_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_DAT_BYTES) throw new Error('DAT exceeds 64 MiB import limit.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return parseDat(Buffer.concat(chunks).toString('utf8'));
  } finally { await handle.close(); }
}
