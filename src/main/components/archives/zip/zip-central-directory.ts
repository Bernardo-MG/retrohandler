import type { FileHandle } from 'node:fs/promises';
import { readExactly } from '../../filesystem/binary-reader';
import type { ArchiveLimits, CentralDirectory, DirectoryEntry } from './zip-entry';

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const ZIP64_MARKER = 0xffffffff;
const MAX_END_BYTES = 65557;
const MAX_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 50000;

export async function readDirectoryLocation(handle: FileHandle, size: number): Promise<CentralDirectory> {
  const length = Math.min(size, MAX_END_BYTES);
  const tailOffset = size - length;
  const tail = await readExactly(handle, length, tailOffset, 'Truncated ZIP footer.');
  const end = findEndRecord(tail);
  const entries = tail.readUInt16LE(end + 10);
  if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== entries) {
    throw new Error('Multi-disk ZIP is unsupported.');
  }
  const directory = {
    entries,
    size: tail.readUInt32LE(end + 12),
    offset: tail.readUInt32LE(end + 16)
  };
  if (!isSupportedDirectory(directory, tailOffset + end)) {
    throw new Error('Unsupported or oversized ZIP directory.');
  }
  return directory;
}

function findEndRecord(tail: Buffer): number {
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    const correctSignature = tail.readUInt32LE(offset) === END_SIGNATURE;
    if (correctSignature && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) {
      return offset;
    }
  }
  throw new Error('Invalid ZIP central directory.');
}

function isSupportedDirectory(directory: CentralDirectory, endOffset: number): boolean {
  return (
    directory.entries <= MAX_ENTRIES &&
    directory.size <= MAX_DIRECTORY_BYTES &&
    directory.offset !== ZIP64_MARKER &&
    directory.offset + directory.size <= endOffset
  );
}

export function selectEntry(
  directory: Buffer,
  count: number,
  basename: string,
  limits: ArchiveLimits
): DirectoryEntry {
  let selected: DirectoryEntry | undefined;
  let position = 0;
  for (let index = 0; index < count; index++) {
    const entry = readDirectoryEntry(directory, position);
    position = entry.end;
    if (entry.name !== basename && !entry.name.endsWith(`/${basename}`)) {
      continue;
    }
    if (selected) {
      throw new Error(`Ambiguous ZIP: multiple ${basename} files.`);
    }
    if (!isSupportedEntry(entry, limits)) {
      throw new Error(`Unsupported ${basename} ZIP entry.`);
    }
    selected = entry;
  }
  if (!selected) {
    throw new Error(`${basename} was not found in the ZIP.`);
  }
  return selected;
}

function readDirectoryEntry(directory: Buffer, position: number): DirectoryEntry {
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

function isSupportedEntry(entry: DirectoryEntry, limits: ArchiveLimits): boolean {
  const supportedCompression = entry.method === 0 || entry.method === 8;
  return (
    !(entry.flags & 1) &&
    supportedCompression &&
    entry.compressed > 0 &&
    entry.compressed <= limits.maxArchiveBytes &&
    entry.size <= limits.maxEntryBytes &&
    entry.compressed !== ZIP64_MARKER &&
    entry.size !== ZIP64_MARKER &&
    entry.offset !== ZIP64_MARKER
  );
}
