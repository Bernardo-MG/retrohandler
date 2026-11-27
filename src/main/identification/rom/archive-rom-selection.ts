import path from 'node:path';
import { selectUniqueEntry } from '../../components/archives/archive-entry-selector';
import { MAX_ARCHIVE_ENTRIES, type ArchiveEntry } from '../../components/archives/archive-reader';

import { isDirectRom } from '../../rom/rom-formats';

const MAX_ROM_BYTES = 1024 * 1024 * 1024;

/** A single library row must not be identified as one ROM if it contains several. */
export function selectRomEntry(entries: readonly ArchiveEntry[]): ArchiveEntry | null {
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('Too many archive entries.');
  }
  const selected = selectUniqueEntry(entries, isRomEntry);
  if (selected.kind !== 'found') {
    return null;
  }
  const entry = selected.entry;
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_ROM_BYTES) {
    throw new Error('ROM entry exceeds size limit.');
  }
  return entry;
}

function isRomEntry(entry: ArchiveEntry): boolean {
  return !entry.directory && isDirectRom(path.extname(entry.name));
}
