import { open, type FileHandle } from 'node:fs/promises';
import type { DatEntry, ParsedDat } from './dat-entry';

const MAX_DAT_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Deliberately restricted Logiqx XML DAT reader. No DTD/entity expansion. */
export class DatReader {
  async read(filename: string): Promise<ParsedDat> {
    const handle = await open(filename, 'r');
    try {
      await this.validateFile(handle);
      return this.parse(await this.readText(handle));
    } finally {
      await handle.close();
    }
  }

  parse(xml: string): ParsedDat {
    const document = this.maskNonMarkup(xml);
    this.validateDocument(document);
    const entries = this.readGameRecords(document);
    if (!entries.length) {
      throw new Error('No supported ROM hashes found in DAT.');
    }
    return { name: this.readCatalogueName(document), entries };
  }

  private async validateFile(handle: FileHandle): Promise<void> {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new Error('DAT must be a regular file.');
    }
    assertDatSize(info.size);
  }

  private async readText(handle: FileHandle): Promise<string> {
    // Bound the actual read even if the file grows after stat().
    const chunks: Buffer[] = [];
    let received = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, MAX_DAT_BYTES + 1 - received));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) {
        break;
      }
      received += bytesRead;
      assertDatSize(received);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private maskNonMarkup(xml: string): string {
    // Comments and CDATA are not markup. Ignore them when looking for ROM records.
    const document = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');
    if (/<!--|<!\[CDATA\[/.test(document)) {
      throw new Error('Incomplete XML comment or CDATA.');
    }
    return document;
  }

  private validateDocument(xml: string): void {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
      throw new Error('DTD and entity declarations are unsupported.');
    }
    if (!/<datafile(?:\s|>)/i.test(xml)) {
      throw new Error('Expected Logiqx XML DAT (<datafile>).');
    }
    if (!/<\/datafile\s*>\s*$/i.test(xml)) {
      throw new Error('Incomplete Logiqx XML DAT.');
    }
  }

  private readCatalogueName(xml: string): string {
    const header = /<header\b[^>]*>([\s\S]*?)<\/header\s*>/i.exec(xml)?.[1] ?? '';
    const name = /<name\s*>([\s\S]*?)<\/name\s*>/i.exec(header)?.[1]?.trim() ?? 'Imported DAT';
    return decodeDatText(name).slice(0, 250);
  }

  private readGameRecords(xml: string): DatEntry[] {
    const entries: DatEntry[] = [];
    for (const game of xml.matchAll(/<(game|machine)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
      const gameName = readAttributes(game[2]).name;
      if (!gameName) {
        continue;
      }
      for (const entry of this.readRomRecords(gameName, game[3])) {
        entries.push(entry);
      }
    }
    return entries;
  }

  private *readRomRecords(game: string, xml: string): Iterable<DatEntry> {
    for (const rom of xml.matchAll(/<rom\b([^>]*?)\s*\/?>/gi)) {
      const entry = this.parseRom(game, readAttributes(rom[1]));
      if (entry) {
        yield entry;
      }
    }
  }

  private parseRom(game: string, fields: Record<string, string>): DatEntry | null {
    const size = Number(fields.size);
    if (!fields.name || !isValidSize(fields.size, size)) {
      return null;
    }
    const crc32 = readDigest(fields.crc, 8);
    const md5 = readDigest(fields.md5, 32);
    const sha1 = readDigest(fields.sha1, 40);
    if (!crc32 && !md5 && !sha1) {
      return null;
    }
    return { game, file: fields.name, size, crc32, md5, sha1 };
  }
}

function assertDatSize(size: number): void {
  if (size > MAX_DAT_BYTES) {
    throw new Error('DAT exceeds 64 MiB import limit.');
  }
}

function isValidSize(raw: string | undefined, size: number): boolean {
  return /^[0-9]+$/.test(raw ?? '') && Number.isSafeInteger(size) && size >= 0;
}

function readDigest(value: string | undefined, length: number): string | null {
  return value && new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(value) ? value.toLowerCase() : null;
}

function readAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null);
  for (const match of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = decodeDatText(match[2] ?? match[3]);
  }
  return attributes;
}

// Unlike the strict gamelist XML decoder, DAT decoding preserves invalid references.
function decodeDatText(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, decodeEntity);
}

function decodeEntity(raw: string, reference: string): string {
  if (reference[0] !== '#') {
    return ENTITIES[reference.toLowerCase()] ?? raw;
  }
  const hexadecimal = reference[1].toLowerCase() === 'x';
  const number = parseInt(reference.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
  return isValidCodePoint(number) ? String.fromCodePoint(number) : raw;
}

function isValidCodePoint(number: number): boolean {
  return Number.isInteger(number) && number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff);
}
