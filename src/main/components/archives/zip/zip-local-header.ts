import type { FileHandle } from 'node:fs/promises';
import { readExactly } from '../../filesystem/binary-reader';
import type { DirectoryEntry, ZipEntry } from './zip-entry';

const LOCAL_SIGNATURE = 0x04034b50;

export async function readLocalHeader(
  handle: FileHandle,
  entry: DirectoryEntry,
  directoryOffset: number
): Promise<ZipEntry> {
  const header = await readExactly(handle, 30, entry.offset, 'Invalid ZIP local header.');
  if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error('Invalid ZIP local header.');
  }
  if (header.readUInt16LE(8) !== entry.method || header.readUInt16LE(6) & 1) {
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
