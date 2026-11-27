import type { IdentificationResult, LibraryEntry } from '../../../shared';
import type { IdentificationRepository } from '../../contracts/persistence';
import type { ParsedDat, FingerprintMatch } from '../../contracts/identification';
import type { FileFingerprint } from '../../components/hashing/content-fingerprint';
import {
  matchFingerprintCandidates,
  type FingerprintMatchCandidate
} from '../../identification/fingerprint-matcher';
import { DatabaseConnection } from '../database-connection';
import { QueryExecutor } from '../sql/query-executor';

type FingerprintRow = Omit<FileFingerprint, 'size'> & {
  bytes: number;
};

export class SqliteIdentificationRepository implements IdentificationRepository {
  constructor(private readonly executor: QueryExecutor) {}

  public importDat(dat: ParsedDat): {
    name: string;
    count: number;
  } {
    this.executor.transaction(() => {
      // Reimport of a DAT with the same header replaces its entries atomically.
      this.executor.execute('identification.insertDatSet', dat.name);
      const id = this.executor.findRequired<{ id: number }>('identification.findDatSet', dat.name).id;
      this.executor.execute('identification.deleteDatEntries', id);
      for (const row of dat.entries) {
        this.executor.execute(
          'identification.insertDatEntry',
          id,
          row.game,
          row.file,
          row.size,
          row.crc32,
          row.md5,
          row.sha1
        );
      }
    });
    return { name: dat.name, count: dat.entries.length };
  }

  public entriesForIdentification(source: string): LibraryEntry[] {
    return this.executor.findAll<LibraryEntry>('identification.entriesForIdentification', source);
  }

  public cachedFingerprint(
    source: string,
    relativePath: string,
    size: number,
    modifiedMs: number
  ): FileFingerprint | null {
    const row = this.executor.findOne<FingerprintRow>(
      'identification.cachedFingerprint',
      source,
      relativePath,
      size,
      modifiedMs
    );
    return row
      ? {
          size: row.bytes,
          modifiedMs: row.modifiedMs,
          crc32: row.crc32,
          md5: row.md5,
          sha1: row.sha1
        }
      : null;
  }

  public matchFingerprint(hashes: FileFingerprint): FingerprintMatch {
    const candidates = this.executor.findAll<FingerprintMatchCandidate>(
      'identification.matchFingerprint',
      hashes.sha1,
      hashes.md5,
      hashes.size,
      hashes.sha1,
      hashes.md5,
      hashes.crc32
    );
    return matchFingerprintCandidates(candidates);
  }

  public saveIdentification(source: string, results: readonly IdentificationResult[]): void {
    this.executor.transaction(() => {
      for (const row of results) {
        const f = row.fingerprint;
        this.executor.execute(
          'identification.saveIdentification',
          source,
          row.relativePath,
          row.status,
          row.title,
          row.datName,
          f?.size ?? null,
          f?.modifiedMs ?? null,
          f?.crc32 ?? null,
          f?.md5 ?? null,
          f?.sha1 ?? null
        );
      }
    });
  }
}

export function createIdentificationRepository(database: DatabaseConnection): IdentificationRepository {
  return new SqliteIdentificationRepository(DatabaseConnection.executorFor(database));
}
