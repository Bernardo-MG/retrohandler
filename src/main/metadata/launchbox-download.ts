import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import type { LaunchBoxImportRepository } from '../contracts/persistence';
import { importLaunchBoxXml } from './launchbox';

export const LAUNCHBOX_ARCHIVE_URL = 'https://gamesdb.launchbox-app.com/Metadata.zip';
const MAX_ZIP = 512 * 1024 * 1024;
const MAX_XML = 750 * 1024 * 1024;
const MAX_DIRECTORY = 32 * 1024 * 1024;
const MAX_ENTRIES = 50000;
export type LaunchBoxUpdate = {
  phase: 'download' | 'extract' | 'import';
  processed: number;
  total: number | null;
};
export type LaunchBoxDownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (update: LaunchBoxUpdate) => void;
  request?: typeof fetch;
};

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('LaunchBox update cancelled.');
}
function u16(b: Buffer, i: number): number { return b.readUInt16LE(i); }
function u32(b: Buffer, i: number): number { return b.readUInt32LE(i); }

/** Inspect the ZIP central directory, selecting only Metadata.xml; no archive paths are trusted. */
export async function locateMetadataXml(zip: string): Promise<{ start: number; compressed: number; size: number; crc: number; method: number }> {
  const handle = await open(zip, 'r');
  try {
    const size = (await handle.stat()).size;
    if (size < 22 || size > MAX_ZIP) throw new Error('Invalid LaunchBox ZIP size.');
    const tail = Buffer.alloc(Math.min(size, 65557));
    await handle.read(tail, 0, tail.length, size - tail.length);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50 && i + 22 + u16(tail, i + 20) === tail.length) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid ZIP central directory.');
    if (u16(tail, eocd + 4) || u16(tail, eocd + 6) ||
        u16(tail, eocd + 8) !== u16(tail, eocd + 10)) throw new Error('Multi-disk ZIP is unsupported.');
    const entries = u16(tail, eocd + 10);
    const directorySize = u32(tail, eocd + 12);
    const directoryOffset = u32(tail, eocd + 16);
    if (entries > MAX_ENTRIES || directorySize > MAX_DIRECTORY ||
        directorySize === 0xffffffff || directoryOffset === 0xffffffff ||
        directoryOffset + directorySize > size) throw new Error('Unsupported or oversized ZIP directory.');
    const directory = Buffer.alloc(directorySize);
    if ((await handle.read(directory, 0, directorySize, directoryOffset)).bytesRead !== directorySize)
      throw new Error('Truncated ZIP directory.');
    let selected: { offset: number; compressed: number; size: number; crc: number; method: number } | null = null;
    let pos = 0;
    for (let i = 0; i < entries; i++) {
      if (pos + 46 > directory.length || u32(directory, pos) !== 0x02014b50)
        throw new Error('Invalid ZIP entry.');
      const flags = u16(directory, pos + 8);
      const method = u16(directory, pos + 10);
      const crc = u32(directory, pos + 16);
      const compressed = u32(directory, pos + 20);
      const uncompressed = u32(directory, pos + 24);
      const nameLen = u16(directory, pos + 28);
      const extraLen = u16(directory, pos + 30);
      const commentLen = u16(directory, pos + 32);
      const offset = u32(directory, pos + 42);
      const end = pos + 46 + nameLen + extraLen + commentLen;
      if (end > directory.length) throw new Error('Truncated ZIP entry.');
      const name = directory.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
      if (name === 'Metadata.xml' || name.endsWith('/Metadata.xml')) {
        if (selected) throw new Error('Ambiguous ZIP: multiple Metadata.xml files.');
        if ((flags & 1) || (method !== 0 && method !== 8) || !compressed ||
            compressed > MAX_ZIP || uncompressed > MAX_XML ||
            compressed === 0xffffffff || uncompressed === 0xffffffff || offset === 0xffffffff)
          throw new Error('Unsupported Metadata.xml ZIP entry.');
        selected = { offset, compressed, size: uncompressed, crc, method };
      }
      pos = end;
    }
    if (!selected) throw new Error('Metadata.xml was not found in the LaunchBox ZIP.');
    const header = Buffer.alloc(30);
    if ((await handle.read(header, 0, 30, selected.offset)).bytesRead !== 30 || u32(header, 0) !== 0x04034b50)
      throw new Error('Invalid ZIP local header.');
    if (u16(header, 8) !== selected.method || (u16(header, 6) & 1)) throw new Error('ZIP header mismatch.');
    const start = selected.offset + 30 + u16(header, 26) + u16(header, 28);
    if (start + selected.compressed > directoryOffset || (selected.method === 0 && selected.compressed !== selected.size))
      throw new Error('ZIP data boundaries are invalid.');
    return { start, compressed: selected.compressed, size: selected.size, crc: selected.crc, method: selected.method };
  } finally { await handle.close(); }
}

// ZIP CRC32 is checked after streaming decompression, not only declared sizes.
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let crc = i;
  for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

export async function extractMetadataXml(zip: string, xml: string, options: LaunchBoxDownloadOptions = {}): Promise<void> {
  cancelled(options.signal);
  const entry = await locateMetadataXml(zip);
  let count = 0;
  let checksum = 0xffffffff;
  const verify = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    count += chunk.length;
    if (count > MAX_XML || count > entry.size) return callback(new Error('LaunchBox XML exceeds declared size.'));
    for (const byte of chunk) checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 255];
    options.onProgress?.({ phase: 'extract', processed: count, total: entry.size });
    callback(null, chunk);
  }});
  const source = createReadStream(zip, { start: entry.start, end: entry.start + entry.compressed - 1, signal: options.signal });
  const target = createWriteStream(xml, { flags: 'wx' });
  if (entry.method === 8) await pipeline(source, createInflateRaw(), verify, target, { signal: options.signal });
  else await pipeline(source, verify, target, { signal: options.signal });
  if (count !== entry.size || ((checksum ^ 0xffffffff) >>> 0) !== entry.crc)
    throw new Error('LaunchBox ZIP integrity check failed.');
}

/** Downloads only from the fixed official URL. All temporary files are removed on success/failure/cancellation. */
export async function downloadLaunchBox(store: LaunchBoxImportRepository, options: LaunchBoxDownloadOptions = {}): Promise<number> {
  cancelled(options.signal);
  const folder = await mkdtemp(path.join(tmpdir(), 'retrohandler-launchbox-'));
  try {
    const request = options.request ?? fetch;
    const response = await request(LAUNCHBOX_ARCHIVE_URL, { signal: options.signal, redirect: 'follow' });
    const resolved = new URL(response.url || LAUNCHBOX_ARCHIVE_URL);
    if (resolved.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(resolved.hostname))
      throw new Error('Unsafe LaunchBox download redirect.');
    if (!response.ok || !response.body) throw new Error(`LaunchBox download failed (HTTP ${response.status}).`);
    const expected = Number(response.headers.get('content-length'));
    if (Number.isFinite(expected) && expected > MAX_ZIP) throw new Error('LaunchBox ZIP exceeds download limit.');
    const zip = path.join(folder, 'Metadata.zip');
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_ZIP) return callback(new Error('LaunchBox ZIP exceeds download limit.'));
      options.onProgress?.({ phase: 'download', processed: bytes, total: expected > 0 ? expected : null });
      callback(null, chunk);
    }});
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), bounded,
      createWriteStream(zip, { flags: 'wx' }), { signal: options.signal });
    cancelled(options.signal);
    const info = await stat(zip);
    if (info.size !== bytes) throw new Error('Incomplete LaunchBox ZIP download.');
    const xml = path.join(folder, 'Metadata.xml');
    await extractMetadataXml(zip, xml, options);
    cancelled(options.signal);
    return await importLaunchBoxXml(xml, store, { signal: options.signal, onProgress: count =>
      options.onProgress?.({ phase: 'import', processed: count, total: null }) });
  } finally { await rm(folder, { recursive: true, force: true }); }
}
