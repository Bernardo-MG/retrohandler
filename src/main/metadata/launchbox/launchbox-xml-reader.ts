import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { LaunchBoxGame } from '../../contracts/persistence';

export const MAX_LAUNCHBOX_XML_BYTES = 750 * 1024 * 1024;
const MAX_GAME_BYTES = 256 * 1024;
const GAME_START = '<Game>';
const GAME_END = '</Game>';

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
};

// Preserve LaunchBox's existing lenient text conversion without entity expansion.
export function xmlText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, decodeEntity)
    .trim();
}

function decodeEntity(_full: string, entity: string): string {
  if (Object.hasOwn(XML_ENTITIES, entity)) {
    return XML_ENTITIES[entity];
  }
  const hexadecimal = entity[1] === 'x';
  const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
  return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : '';
}

function isValidCodePoint(value: number): boolean {
  return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
}

function readTag(xml: string, name: string): string {
  const match = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
  return match ? xmlText(match[1]) : '';
}

/** LaunchBox's exported Game nodes; no XML entity expansion or executable XML features. */
export function parseLaunchBoxGame(xml: string): LaunchBoxGame | null {
  const id = Number(readTag(xml, 'DatabaseID') || readTag(xml, 'ID'));
  const title = readTag(xml, 'Name') || readTag(xml, 'Title');
  const platform = readTag(xml, 'Platform');
  if (!Number.isSafeInteger(id) || id <= 0 || !title || !platform) {
    return null;
  }
  return {
    id,
    title: title.slice(0, 200),
    platform: platform.slice(0, 120),
    released: readTag(xml, 'ReleaseDate').slice(0, 10),
    description: (readTag(xml, 'Overview') || readTag(xml, 'Notes')).slice(0, 4000),
    developer: readTag(xml, 'Developer').slice(0, 200),
    publisher: readTag(xml, 'Publisher').slice(0, 200),
    genre: (readTag(xml, 'Genres') || readTag(xml, 'Genre')).slice(0, 200)
  };
}

export function assertImportNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('LaunchBox import cancelled.');
  }
}

/** Opens a bounded stream of records. This reader never touches the repository. */
export class LaunchBoxXmlReader {
  async open(file: string, signal?: AbortSignal): Promise<AsyncIterable<LaunchBoxGame>> {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_LAUNCHBOX_XML_BYTES) {
      throw new Error('LaunchBox XML is too large or unavailable.');
    }
    assertImportNotCancelled(signal);
    return this.readRecords(file, signal);
  }

  private async *readRecords(file: string, signal?: AbortSignal): AsyncGenerator<LaunchBoxGame> {
    const records = new GameRecordBuffer();
    const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024, signal });
    // Also bound the raw stream in case the input file grows after stat().
    let totalBytes = 0;
    for await (const chunk of stream) {
      assertImportNotCancelled(signal);
      totalBytes += Buffer.byteLength(chunk, 'utf8');
      if (totalBytes > MAX_LAUNCHBOX_XML_BYTES) {
        throw new Error('LaunchBox XML is too large or unavailable.');
      }
      yield* records.consume(chunk);
    }
    records.assertComplete();
    assertImportNotCancelled(signal);
  }
}

/** Per-file parsing state, including declarations split across chunk boundaries. */
class GameRecordBuffer {
  private buffer = '';
  private declarationTail = '';

  *consume(chunk: string): Generator<LaunchBoxGame> {
    this.rejectEntityDeclarations(chunk);
    this.buffer += chunk;
    for (; ;) {
      const node = this.takeRecord();
      if (node === null) {
        return;
      }
      const game = parseLaunchBoxGame(node);
      if (game) {
        yield game;
      }
    }
  }

  assertComplete(): void {
    if (this.buffer.includes(GAME_START)) {
      throw new Error('Truncated LaunchBox XML.');
    }
  }

  private rejectEntityDeclarations(chunk: string): void {
    const text = this.declarationTail + chunk;
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
      throw new Error('XML declarations with entities are not supported.');
    }
    this.declarationTail = text.slice(-10);
  }

  private takeRecord(): string | null {
    const start = this.buffer.indexOf(GAME_START);
    if (start < 0) {
      this.buffer = this.buffer.slice(-(GAME_START.length - 1));
      return null;
    }
    const end = this.buffer.indexOf(GAME_END, start);
    if (end < 0) {
      this.buffer = this.buffer.slice(start);
      this.assertRecordSize(this.buffer);
      return null;
    }
    const next = end + GAME_END.length;
    const node = this.buffer.slice(start, next);
    this.assertRecordSize(node);
    this.buffer = this.buffer.slice(next);
    return node;
  }

  private assertRecordSize(node: string): void {
    if (Buffer.byteLength(node, 'utf8') > MAX_GAME_BYTES) {
      throw new Error('Oversized LaunchBox game record.');
    }
  }
}
