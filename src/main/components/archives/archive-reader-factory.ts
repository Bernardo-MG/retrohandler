import type { ArchiveLimits } from './archive-limits';
import type { ArchiveReader } from './archive-reader';
import { CompositeArchiveReader } from './composite-archive-reader';
import { SevenZipArchiveReader } from './seven-zip';
import { ZipArchiveReader } from './zip';

/** Prefer native reading; delegate recognized unsupported features to the external backend. */
export function createArchiveReader(limits: ArchiveLimits): ArchiveReader {
  return new CompositeArchiveReader([new ZipArchiveReader(limits), new SevenZipArchiveReader()]);
}

/** Use only the restricted native backend, with no external fallback. */
export function createRestrictedArchiveReader(limits: ArchiveLimits): ArchiveReader {
  return new ZipArchiveReader(limits);
}
