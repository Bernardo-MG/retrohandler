import type { FileHandle } from 'node:fs/promises';
import { readExactly } from '../../filesystem/binary-reader';
import { selectEntryByName } from '../archive-entry-selector';
import { isValidArchiveEntrySize } from '../archive-entry-validation';
import type { ArchiveLimits } from '../archive-limits';
import type { CentralDirectory, DirectoryEntry } from './zip-entry';

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const ZIP64_MARKER = 0xffffffff;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const MAX_END_BYTES = 65557;
const MAX_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 50000;

/** An explicitly recognized ZIP feature outside the classic reader's capabilities. */
export class UnsupportedZipFeatureError extends Error {}

export async function readDirectoryLocation(handle: FileHandle, size: number): Promise<CentralDirectory> {
  const length = Math.min(size, MAX_END_BYTES);
  const tailOffset = size - length;
  const tail = await readExactly(handle, length, tailOffset, 'Truncated ZIP footer.');
  const end = findEndRecord(tail);
  const entries = tail.readUInt16LE(end + 10);
  if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) {
    throw new UnsupportedZipFeatureError('Multi-disk ZIP is unsupported.');
  }
  if (tail.readUInt16LE(end + 8) !== entries) {
    throw new Error('Invalid ZIP directory entry count.');
  }
  const directory = {
    entries,
    size: tail.readUInt32LE(end + 12),
    offset: tail.readUInt32LE(end + 16)
  };
  const endOffset = tailOffset + end;
  if (entries === 0xffff || directory.offset === ZIP64_MARKER || directory.size === ZIP64_MARKER) {
    // A sentinel alone may be corrupt data. Recognize ZIP64 from its locator and end record.
    if (await hasZip64EndRecord(handle, endOffset)) {
      throw new UnsupportedZipFeatureError('Unsupported or oversized ZIP directory.');
    }
  }
  if (!isSupportedDirectory(directory, endOffset)) {
    throw new Error('Unsupported or oversized ZIP directory.');
  }
  return directory;
}

async function hasZip64EndRecord(handle: FileHandle, endOffset: number): Promise<boolean> {
  const locatorOffset = endOffset - 20;
  if (locatorOffset < 56) {
    return false;
  }
  const locator = await readExactly(handle, 20, locatorOffset, 'Truncated ZIP64 locator.');
  if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) {
    return false;
  }
  const recordOffset = locator.readBigUInt64LE(8);
  if (recordOffset > BigInt(locatorOffset - 56)) {
    return false;
  }
  const record = await readExactly(handle, 56, Number(recordOffset), 'Truncated ZIP64 end record.');
  const recordSize = record.readBigUInt64LE(4);
  return (
    record.readUInt32LE(0) === ZIP64_END_SIGNATURE &&
    recordSize >= 44n &&
    recordOffset + 12n + recordSize === BigInt(locatorOffset)
  );
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
  entryName: string,
  limits: ArchiveLimits
): DirectoryEntry {
  const selected = selectEntryByName(
    directoryEntries(directory, count),
    entryName,
    (entry) => {
      if (!isSupportedEntry(entry, limits)) {
        throw new Error(`Unsupported ${entryName} ZIP entry.`);
      }
    }
  );
  if (selected.kind === 'ambiguous') {
    throw new Error(`Ambiguous ZIP: multiple ${entryName} files.`);
  }
  if (selected.kind === 'missing') {
    throw new Error(`${entryName} was not found in the ZIP.`);
  }
  return selected.entry;
}

export function* directoryEntries(directory: Buffer, count: number): IterableIterator<DirectoryEntry> {
  let position = 0;
  for (let index = 0; index < count; index++) {
    const entry = readDirectoryEntry(directory, position);
    position = entry.end;
    yield entry;
  }
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

/** Probe format capabilities, not errors reading or verifying entry data. */
export function hasUnsupportedZipFeature(entry: DirectoryEntry): boolean {
  return (
    (entry.method !== 0 && entry.method !== 8) ||
    (entry.flags & 1) !== 0 ||
    entry.compressed === ZIP64_MARKER ||
    entry.size === ZIP64_MARKER ||
    entry.offset === ZIP64_MARKER ||
    (entry.compressed === 0 && entry.size === 0 && !entry.name.endsWith('/')) ||
    // Leave filename encoding variants to the more complete archive implementation.
    /[^\x00-\x7f]/.test(entry.name)
  );
}

function isSupportedEntry(entry: DirectoryEntry, limits: ArchiveLimits): boolean {
  const supportedCompression = entry.method === 0 || entry.method === 8;
  return (
    !(entry.flags & 1) &&
    supportedCompression &&
    entry.compressed > 0 &&
    entry.compressed <= limits.maxArchiveBytes &&
    isValidArchiveEntrySize(entry.size, limits.maxEntryBytes) &&
    entry.compressed !== ZIP64_MARKER &&
    entry.size !== ZIP64_MARKER &&
    entry.offset !== ZIP64_MARKER
  );
}
