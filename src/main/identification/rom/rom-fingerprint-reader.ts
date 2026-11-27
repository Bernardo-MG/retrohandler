import { ArchiveFingerprintReader, ArchiveSource, type ArchiveReader } from '../../components/archives';
import { throwIfCancelled } from '../../components/async/cancellation';
import type { FileFingerprint } from '../../components/hashing/content-fingerprint';
import { FingerprintReader } from '../../components/hashing/fingerprint-reader';
import type { IdentificationRepository } from '../../contracts/persistence';
import { isDirectRom, isRomArchive } from '../../rom/rom-formats';
import { selectRomEntry } from './archive-rom-selection';
import { RomSource, type RomTarget } from './rom-source';

export interface RomFingerprintStrategy {
  supports(extension: string): boolean;
  fingerprint(file: RomSource, signal?: AbortSignal): Promise<FileFingerprint | null>;
}

/** Select an explicit strategy and validate the source around its work. */
export class RomFingerprintReader {
  constructor(private readonly strategies: readonly RomFingerprintStrategy[]) {}

  public async read(target: RomTarget, signal?: AbortSignal): Promise<FileFingerprint | null> {
    throwIfCancelled(signal);
    const strategy = this.strategyFor(target.extension);
    if (!strategy) {
      return null;
    }
    const file = await RomSource.resolve(target);
    throwIfCancelled(signal);
    const fingerprint = await strategy.fingerprint(file, signal);
    await file.assertUnchanged();
    throwIfCancelled(signal);
    return fingerprint;
  }

  private strategyFor(extension: string): RomFingerprintStrategy | undefined {
    return this.strategies.find((strategy) => strategy.supports(extension));
  }
}

/** Use the existing persistent size/mtime cache only for directly hashable ROMs. */
export class DirectRomFingerprint implements RomFingerprintStrategy {
  constructor(
    private readonly cache: Pick<IdentificationRepository, 'cachedFingerprint'>,
    private readonly reader: FingerprintReader
  ) {}

  public supports(extension: string): boolean {
    return isDirectRom(extension);
  }

  public async fingerprint(file: RomSource, signal?: AbortSignal): Promise<FileFingerprint> {
    const cached = this.cache.cachedFingerprint(
      file.target.source,
      file.target.relativePath,
      file.stats.size,
      file.stats.mtimeMs
    );
    return cached ?? (await this.reader.readFile(file.filename, signal));
  }
}

/** Stream the single supported archive entry; never fingerprint the container itself. */
export class ArchivedRomFingerprint implements RomFingerprintStrategy {
  private readonly fingerprints: ArchiveFingerprintReader;

  constructor(
    private readonly archive: ArchiveReader,
    reader: FingerprintReader
  ) {
    this.fingerprints = new ArchiveFingerprintReader(reader);
  }

  public supports(extension: string): boolean {
    return isRomArchive(extension);
  }

  public async fingerprint(file: RomSource, signal?: AbortSignal): Promise<FileFingerprint | null> {
    const source = new ArchiveSource(this.archive, file.identity);
    const entries = await source.list(signal);
    throwIfCancelled(signal);
    const entry = selectRomEntry(entries);
    if (!entry) {
      return null;
    }
    await file.assertUnchanged();
    throwIfCancelled(signal);
    const hashes = await this.fingerprints.read(source, entry, signal);
    return { ...hashes, modifiedMs: file.stats.mtimeMs };
  }
}
