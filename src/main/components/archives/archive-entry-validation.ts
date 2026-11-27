/** Validate declared uncompressed sizes before allocating or opening entry data. */
export function isValidArchiveEntrySize(size: number, maxBytes = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(size) && size >= 0 && size <= maxBytes;
}

export function assertArchiveEntrySize(
  size: number,
  maxBytes = Number.MAX_SAFE_INTEGER,
  message = 'Archive entry exceeds size limit.'
): void {
  if (!isValidArchiveEntrySize(size, maxBytes)) {
    throw new Error(message);
  }
}

/** Accept a count rather than a collection so streaming parsers can check incrementally. */
export function assertArchiveEntryCount(count: number, maxEntries: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > maxEntries) {
    throw new Error('Too many archive entries.');
  }
}
