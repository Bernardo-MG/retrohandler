import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { LaunchBoxGame, LibraryStore } from '../database/library-store';

const MAX_FILE_BYTES = 750 * 1024 * 1024;
const MAX_GAME_BYTES = 256 * 1024;

/** Decode simple XML text without expanding arbitrary DTD entities. */
export function xmlText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (full, entity: string) => {
      const named: Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
      if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
      const n = Number.parseInt(entity.slice(entity[1] === 'x' ? 2 : 1), entity[1] === 'x' ? 16 : 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }).trim();
}
function tag(xml: string, name: string): string {
  const match = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
  return match ? xmlText(match[1]) : '';
}
/** LaunchBox's exported Game nodes; no XML entity expansion or executable XML features. */
export function parseLaunchBoxGame(xml: string): LaunchBoxGame | null {
  const id = Number(tag(xml,'DatabaseID') || tag(xml,'ID'));
  const title = tag(xml,'Name') || tag(xml,'Title');
  const platform = tag(xml,'Platform');
  if (!Number.isSafeInteger(id) || id <= 0 || !title || !platform) return null;
  return { id, title:title.slice(0,200), platform:platform.slice(0,120),
    released:(tag(xml,'ReleaseDate') || '').slice(0,10),
    description:(tag(xml,'Overview') || tag(xml,'Notes')).slice(0,4000),
    developer:tag(xml,'Developer').slice(0,200), publisher:tag(xml,'Publisher').slice(0,200),
    genre:(tag(xml,'Genres') || tag(xml,'Genre')).slice(0,200) };
}

/** Stream large extracted LaunchBox Metadata.xml without loading it all into memory. */
export async function importLaunchBoxXml(file: string, store: LibraryStore, options: { signal?: AbortSignal; onProgress?: (count: number) => void } = {}): Promise<number> {
  if (!store.beginLaunchBoxImport || !store.addLaunchBoxGame || !store.finishLaunchBoxImport || !store.abortLaunchBoxImport)
    throw new Error('LaunchBox import storage unavailable.');
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('LaunchBox XML is too large or unavailable.');
  if (options.signal?.aborted) throw new Error('LaunchBox import cancelled.');
  store.beginLaunchBoxImport();
  let buffer = '';
  let count = 0;
  let seenRoot = false;
  try {
    for await (const chunk of createReadStream(file,{encoding:'utf8',highWaterMark:64*1024,signal:options.signal})) {
      if (options.signal?.aborted) throw new Error('LaunchBox import cancelled.');
      buffer += chunk;
      if (!seenRoot) {
        if (/<!DOCTYPE|<!ENTITY/i.test(buffer)) throw new Error('XML declarations with entities are not supported.');
        if (buffer.length > 128*1024) seenRoot = true;
      }
      while (true) {
        const start = buffer.indexOf('<Game>');
        if (start < 0) { buffer = buffer.slice(-16); break; }
        const end = buffer.indexOf('</Game>',start);
        if (end < 0) {
          buffer = buffer.slice(start);
          if (Buffer.byteLength(buffer,'utf8') > MAX_GAME_BYTES) throw new Error('Oversized LaunchBox game record.');
          break;
        }
        const node = buffer.slice(start,end+7);
        if (Buffer.byteLength(node,'utf8') > MAX_GAME_BYTES) throw new Error('Oversized LaunchBox game record.');
        const game = parseLaunchBoxGame(node);
        if (game) { store.addLaunchBoxGame(game); count++; if (count % 500 === 0) options.onProgress?.(count); }
        buffer = buffer.slice(end+7);
      }
    }
    if (buffer.includes('<Game>')) throw new Error('Truncated LaunchBox XML.');
    if (!count) throw new Error('No LaunchBox games found. Select the extracted Metadata.xml, not the ZIP archive.');
    if (options.signal?.aborted) throw new Error('LaunchBox import cancelled.');
    options.onProgress?.(count);
    if (options.signal?.aborted) throw new Error('LaunchBox import cancelled.');
    return store.finishLaunchBoxImport();
  } catch (error) { store.abortLaunchBoxImport(); throw error; }
}
