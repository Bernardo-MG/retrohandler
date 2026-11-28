/** Byte limits for readers that enforce archive and uncompressed entry sizes. */
export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxEntryBytes: number;
}

/** Entry-count policy for 7-Zip listings and ROM identification. */
export const DEFAULT_MAX_ARCHIVE_ENTRIES = 10000;
