import path from 'node:path';
import type { CollectionInfo, Rom, ScanResult, ScanWarning } from '../../../shared';
import type { CollectionRepository } from '../../contracts/persistence';
import { DatabaseConnection } from '../database-connection';
import { QueryExecutor } from '../sql/query-executor';

type CollectionListRow = Omit<CollectionInfo, 'warningCount'> & {
  warningsJson: string
};

type CollectionRow = {
  root_path: string;
  scanned_at: string;
  ignored: number;
  warnings_json: string
};

type RomRow = {
  id: string;
  name: string;
  system: string;
  relative_path: string;
  extension: string;
  bytes: number
};

export class SqliteCollectionRepository implements CollectionRepository {
  constructor(private readonly executor: QueryExecutor) {}

  saveScan(result: ScanResult): void {
    this.executor.transaction(() => {
      this.executor.execute('collections.upsertCollection', result.source, result.scannedAt, result.ignored, JSON.stringify(result.warnings ?? []));
      const old = new Map(this.executor.findAll<RomRow>('roms.existingRows', result.source).map(row => [row.relative_path, row]));
      for (const game of result.games) {
        const previous = old.get(game.relativePath);
        old.delete(game.relativePath);
        if (previous && previous.id === game.id && previous.name === game.name &&
          previous.system === game.system && previous.extension === game.extension &&
          previous.bytes === game.bytes) {
          continue;
        }
        this.executor.execute('roms.upsertRom',
          result.source,
          game.relativePath,
          game.id,
          game.name,
          game.system,
          game.extension,
          game.bytes
        );
      }
      // An unreadable directory could conceal files. Never erase them on a partial scan.
      if (!(result.warnings?.length)) {
        for (const relativePath of old.keys()) {
          this.executor.execute('roms.deleteRom', result.source, relativePath);
        }
      }
    });
  }

  loadLastScan(): ScanResult | null {
    const row = this.executor.findOne<CollectionRow>('collections.lastScan');
    if (!row) {
      return null;
    }
    const games = this.executor.findAll<RomRow>('roms.lastScanGames', row.root_path).map((rom): Rom => ({
      id: rom.id,
      name: rom.name,
      system: rom.system,
      relativePath: rom.relative_path,
      extension: rom.extension,
      bytes: rom.bytes
    }));
    const warnings = JSON.parse(row.warnings_json) as ScanWarning[];
    return {
      source: row.root_path,
      games,
      ignored: row.ignored,
      scannedAt: row.scanned_at,
      warnings
    };
  }

  listCollections(): CollectionInfo[] {
    const rows = this.executor.findAll<CollectionListRow>('collections.listCollections');
    return rows.map(row => ({
      rootPath: row.rootPath,
      label: row.label || path.basename(row.rootPath) || row.rootPath,
      scannedAt: row.scannedAt,
      gameCount: row.gameCount,
      ignored: row.ignored,
      warningCount: (JSON.parse(row.warningsJson) as ScanWarning[]).length
    }));
  }

  renameCollection(source: string, label: string): void {
    const newLabel = label.trim();
    if (!newLabel || newLabel.length > 120) {
      throw new Error('Collection name must be 1–120 characters.');
    }
    const changes = this.executor.execute('collections.renameCollection', newLabel, source);
    if (!changes) {
      throw new Error('Collection not found.');
    }
  }

  removeCollection(source: string): void {
    const changes = this.executor.execute('collections.removeCollection', source);
    if (!changes) {
      throw new Error('Collection not found.');
    }
  }
}

export function createCollectionRepository(database: DatabaseConnection): CollectionRepository {
  return new SqliteCollectionRepository(DatabaseConnection.executorFor(database));
}
