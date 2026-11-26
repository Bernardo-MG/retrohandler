import { createReadStream, createWriteStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { Crc32 } from '../hashing/crc32';

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
const MAX_END_BYTES = 65557;
const MAX_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 50000;

export interface ZipEntry {
  start: number;
  compressed: number;
  size: number;
  crc: number;
  method: number;
}

type ArchiveLimits = {
  maxArchiveBytes: number;
  maxEntryBytes: number;
};

type ExtractOptions = {
  signal?: AbortSignal;
  onProgress?: (processed: number, total: number) => void;
};

type CentralDirectory = {
  offset: number;
  size: number;
  entries: number;
};

type DirectoryEntry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  end: number;
};

/** Restricted classic ZIP reader. Never uses an archive name as an output path. */
export class ZipArchiveReader {
  constructor(private readonly filename: string, private readonly limits: ArchiveLimits) {}

  /** Select exactly one file by basename, optionally inside an archive directory. */
  async findEntry(basename: string): Promise<ZipEntry> {
    const handle = await open(this.filename, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 22 || info.size > this.limits.maxArchiveBytes) {
        throw new Error('Invalid ZIP size.');
      }
      const directory = await this.readDirectoryLocation(handle, info.size);
      const bytes = await readExactly(handle, directory.size, directory.offset, 'Truncated ZIP directory.');
      const selected = this.selectEntry(bytes, directory.entries, basename);
      return await this.readLocalHeader(handle, selected, directory.offset);
    } finally {
      await handle.close();
    }
  }

  async extract(basename: string, destination: string, options: ExtractOptions = {}): Promise<void> {
    options.signal?.throwIfAborted();
    const entry = await this.findEntry(basename);
    const verifier = new EntryVerifier(entry, options.onProgress);
    const source = createReadStream(this.filename, {
      start: entry.start,
      end: entry.start + entry.compressed - 1,
      signal: options.signal
    });
    const target = createWriteStream(destination, { flags: 'wx' });
    if (entry.method === 8) {
      await pipeline(source, createInflateRaw(), verifier, target, { signal: options.signal });
    } else {
      await pipeline(source, verifier, target, { signal: options.signal });
    }
  }

  private async readDirectoryLocation(handle: FileHandle, size: number): Promise<CentralDirectory> {
    const length = Math.min(size, MAX_END_BYTES);
    const tailOffset = size - length;
    const tail = await readExactly(handle, length, tailOffset, 'Truncated ZIP footer.');
    const end = this.findEndRecord(tail);
    const entries = tail.readUInt16LE(end + 10);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== entries) {
      throw new Error('Multi-disk ZIP is unsupported.');
    }
    const directory = {
      entries,
      size: tail.readUInt32LE(end + 12),
      offset: tail.readUInt32LE(end + 16)
    };
    if (!this.isSupportedDirectory(directory, tailOffset + end)) {
      throw new Error('Unsupported or oversized ZIP directory.');
    }
    return directory;
  }

  private findEndRecord(tail: Buffer): number {
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      const correctSignature = tail.readUInt32LE(offset) === END_SIGNATURE;
      if (correctSignature && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) {
        return offset;
      }
    }
    throw new Error('Invalid ZIP central directory.');
  }

  private isSupportedDirectory(directory: CentralDirectory, endOffset: number): boolean {
    return directory.entries <= MAX_ENTRIES && directory.size <= MAX_DIRECTORY_BYTES &&
      directory.offset !== ZIP64_MARKER && directory.offset + directory.size <= endOffset;
  }

  private selectEntry(directory: Buffer, count: number, basename: string): DirectoryEntry {
    let selected: DirectoryEntry | undefined;
    let position = 0;
    for (let index = 0; index < count; index++) {
      const entry = this.readDirectoryEntry(directory, position);
      position = entry.end;
      if (entry.name !== basename && !entry.name.endsWith(`/${basename}`)) {
        continue;
      }
      if (selected) {
        throw new Error(`Ambiguous ZIP: multiple ${basename} files.`);
      }
      if (!this.isSupportedEntry(entry)) {
        throw new Error(`Unsupported ${basename} ZIP entry.`);
      }
      selected = entry;
    }
    if (!selected) {
      throw new Error(`${basename} was not found in the ZIP.`);
    }
    return selected;
  }

  private readDirectoryEntry(directory: Buffer, position: number): DirectoryEntry {
    if (position + 46 > directory.length || directory.readUInt32LE(position) !== ENTRY_SIGNATURE) {
      throw new Error('Invalid ZIP entry.');
    }
    const nameLength = directory.readUInt16LE(position + 28);
    const extraLength = directory.readUInt16LE(position + 30);
    const commentLength = directory.readUInt16LE(position + 32);
    const nameStart = position + 46;
    const end = nameStart + nameLength + extraLength + commentLength;
    if (end > directory.length) {
      throw new Error('Truncated ZIP entry.');
    }
    return {
      name: directory.subarray(nameStart, nameStart + nameLength).toString('utf8'),
      flags: directory.readUInt16LE(position + 8),
      method: directory.readUInt16LE(position + 10),
      crc: directory.readUInt32LE(position + 16),
      compressed: directory.readUInt32LE(position + 20),
      size: directory.readUInt32LE(position + 24),
      offset: directory.readUInt32LE(position + 42),
      end
    };
  }

  private isSupportedEntry(entry: DirectoryEntry): boolean {
    const supportedCompression = entry.method === 0 || entry.method === 8;
    return !(entry.flags & 1) && supportedCompression && entry.compressed > 0 &&
      entry.compressed <= this.limits.maxArchiveBytes && entry.size <= this.limits.maxEntryBytes &&
      entry.compressed !== ZIP64_MARKER && entry.size !== ZIP64_MARKER && entry.offset !== ZIP64_MARKER;
  }

  private async readLocalHeader(handle: FileHandle, entry: DirectoryEntry, directoryOffset: number): Promise<ZipEntry> {
    const header = await readExactly(handle, 30, entry.offset, 'Invalid ZIP local header.');
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error('Invalid ZIP local header.');
    }
    if (header.readUInt16LE(8) !== entry.method || (header.readUInt16LE(6) & 1)) {
      throw new Error('ZIP header mismatch.');
    }
    const nameLength = header.readUInt16LE(26);
    const start = entry.offset + 30 + nameLength + header.readUInt16LE(28);
    if (start + entry.compressed > directoryOffset || (entry.method === 0 && entry.compressed !== entry.size)) {
      throw new Error('ZIP data boundaries are invalid.');
    }
    const localName = await readExactly(handle, nameLength, entry.offset + 30, 'Invalid ZIP local filename.');
    if (localName.toString('utf8') !== entry.name) {
      throw new Error('ZIP header mismatch.');
    }
    return { start, compressed: entry.compressed, size: entry.size, crc: entry.crc, method: entry.method };
  }
}

async function readExactly(handle: FileHandle, length: number, offset: number, errorMessage: string): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let received = 0;
  while (received < length) {
    const { bytesRead } = await handle.read(buffer, received, length - received, offset + received);
    if (!bytesRead) {
      throw new Error(errorMessage);
    }
    received += bytesRead;
  }
  return buffer;
}

class EntryVerifier extends Transform {
  private processed = 0;
  private readonly checksum = new Crc32();

  constructor(private readonly entry: ZipEntry, private readonly onProgress?: ExtractOptions['onProgress']) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.processed += chunk.length;
    if (this.processed > this.entry.size) {
      callback(new Error('ZIP entry exceeds declared size.'));
      return;
    }
    this.checksum.update(chunk);
    try {
      this.onProgress?.(this.processed, this.entry.size);
      callback(null, chunk);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(callback: TransformCallback): void {
    if (this.processed !== this.entry.size || this.checksum.digest() !== this.entry.crc) {
      callback(new Error('ZIP integrity check failed.'));
      return;
    }
    callback();
  }
}
