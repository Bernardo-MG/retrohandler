import path from 'node:path';
import { MAX_ARCHIVE_ENTRIES, type ArchiveEntry } from '../../components/archives/archive-reader';

import { isDirectRom } from '../../rom/rom-formats';

const MAX_ROM_BYTES = 1024 * 1024 * 1024;

/** A single library row must not be identified as one ROM if it contains several. */
export function selectRomEntry(entries: readonly ArchiveEntry[]): ArchiveEntry | null {
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('Too many archive entries.');
  }
  const candidates = entries.filter(isRomEntry);
  if (candidates.length !== 1) {
    return null;
  }
  const entry = candidates[0];
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_ROM_BYTES) {
    throw new Error('ROM entry exceeds size limit.');
  }
  return entry;
}

function isRomEntry(entry: ArchiveEntry): boolean {
  return !entry.directory && isDirectRom(path.extname(entry.name));
}
