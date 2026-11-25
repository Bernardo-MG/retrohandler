import type { IdentificationResult, IdentificationStatus, LibraryEntry } from '../../../shared';
import type { IdentificationRepository } from '../../contracts/persistence';
import type { ParsedDat } from '../../identification/dat';
import type { RomHashes } from '../../identification/hashes';
import { DatabaseConnection } from '../database-connection';
import { QueryExecutor } from '../sql/query-executor';

type FingerprintMatchRow = {
  game: string;
  datName: string;
  evidence: string
};

type FingerprintRow = Omit<RomHashes, 'size'> & {
  bytes: number
};

export class SqliteIdentificationRepository implements IdentificationRepository {
  constructor(private readonly executor: QueryExecutor) {}

  importDat(dat: ParsedDat): {
    name: string;
    count: number
  } {
    this.executor.transaction(() => {
      // Reimport of a DAT with the same header replaces its entries atomically.
      this.executor.execute('identification.insertDatSet', dat.name);
      const id = this.executor.findRequired<{ id: number }>('identification.findDatSet', dat.name).id;
      this.executor.execute('identification.deleteDatEntries', id);
      for (const row of dat.entries) {
        this.executor.execute('identification.insertDatEntry', id, row.game, row.file, row.size, row.crc32, row.md5, row.sha1);
      }
    });
    return { name: dat.name, count: dat.entries.length };
  }

  entriesForIdentification(source: string): LibraryEntry[] {
    return this.executor.findAll<LibraryEntry>('identification.entriesForIdentification', source);
  }

  cachedFingerprint(source: string, relativePath: string, size: number, modifiedMs: number): RomHashes | null {
    const row = this.executor.findOne<FingerprintRow>('identification.cachedFingerprint', source, relativePath, size, modifiedMs);
    return row ? {
      size: row.bytes,
      modifiedMs: row.modifiedMs,
      crc32: row.crc32,
      md5: row.md5,
      sha1: row.sha1
    } : null;
  }

  matchFingerprint(hashes: RomHashes): {
    status: IdentificationStatus;
    title: string | null;
    datName: string | null
  } {
    // SHA1 and MD5 are strong match evidence. CRC32 is weaker and always "probable".
    const candidates = this.executor.findAll<FingerprintMatchRow>('identification.matchFingerprint',
      hashes.sha1,
      hashes.md5,
      hashes.size,
      hashes.sha1,
      hashes.md5,
      hashes.crc32
    );
    if (!candidates.length) {
      return { status: 'unknown', title: null, datName: null };
    }
    const best = candidates.filter(row => row.evidence === 'sha1');
    const matches = best.length ? best : candidates.filter(row => row.evidence === 'md5');
    const selected = matches.length ? matches : candidates;
    if (new Set(selected.map(row => row.game)).size > 1) {
      return { status: 'ambiguous', title: null, datName: null };
    }
    return {
      status: selected[0].evidence === 'crc' ? 'probable' : 'verified',
      title: selected[0].game,
      datName: selected[0].datName
    };
  }

  saveIdentification(source: string, results: IdentificationResult[]): void {
    this.executor.transaction(() => {
      for (const row of results) {
        const f = row.fingerprint;
        this.executor.execute('identification.saveIdentification',
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
