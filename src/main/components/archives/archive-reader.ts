import type { Readable } from 'node:stream';
import type { ArchiveEntry } from './archive-entry';

/** List entries and open an exact entry name without extracting to disk. */
export interface ArchiveReader {
  list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]>;
  /** Open a uniquely selected non-directory entry by its full name. */
  open(filename: string, entryName: string, signal?: AbortSignal): Promise<Readable>;
}

/** Reader capability used by the dispatcher, not by archive consumers. */
export interface ArchiveFormatReader extends ArchiveReader {
  supports(extension: string): boolean;
  /** Return false only for unsupported features; propagate read and validation failures. */
  supportsArchive?(filename: string, signal?: AbortSignal): Promise<boolean>;
}
