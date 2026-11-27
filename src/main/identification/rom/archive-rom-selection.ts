import path from 'node:path';
import {
  assertArchiveEntryCount,
  assertArchiveEntrySize,
  DEFAULT_MAX_ARCHIVE_ENTRIES,
  selectUniqueEntry,
  type ArchiveEntry
} from '../../components/archives';
import { isDirectRom } from '../../rom/rom-formats';

export const MAX_ROM_BYTES = 1024 * 1024 * 1024;

/** A single library row must not be identified as one ROM if it contains several. */
export function selectRomEntry(entries: readonly ArchiveEntry[]): ArchiveEntry | null {
  assertArchiveEntryCount(entries.length, DEFAULT_MAX_ARCHIVE_ENTRIES);
  const selected = selectUniqueEntry(entries, isRomEntry);
  if (selected.kind !== 'found') {
    return null;
  }
  const entry = selected.entry;
  assertArchiveEntrySize(entry.size, MAX_ROM_BYTES, 'ROM entry exceeds size limit.');
  return entry;
}

function isRomEntry(entry: ArchiveEntry): boolean {
  return !entry.directory && isDirectRom(path.extname(entry.name));
}
