import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Rom, ScanResult, ScanWarning } from '../../shared';

/** The native module is loaded in Electron's main process, never in the renderer.
 * Kept behind a small structural interface to avoid leaking SQLite into services. */
export interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface DatabaseHandle {
  pragma(sql: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

type CollectionRow = { root_path: string; scanned_at: string; ignored: number; warnings_json: string };
type RomRow = { id: string; name: string; system: string; relative_path: string; extension: string; bytes: number };

export interface LibraryStore {
  saveScan(result: ScanResult): void;
  loadLastScan(): ScanResult | null;
}

/** The database is deliberately stored outside the ROM collection. */
export class SqliteLibraryStore implements LibraryStore {
  private readonly db: DatabaseHandle;

  constructor(filePath: string, createDatabase?: (filename: string) => DatabaseHandle) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    // better-sqlite3 ships a native Electron-compatible build after npm rebuild.
    if (createDatabase) this.db = createDatabase(filePath);
    else {
      const Database = require('better-sqlite3') as new (filename: string) => DatabaseHandle;
      this.db = new Database(filePath);
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version(version)
        SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
      CREATE TABLE IF NOT EXISTS collections (
        root_path TEXT PRIMARY KEY,
        scanned_at TEXT NOT NULL,
        ignored INTEGER NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS rom_files (
        source_root TEXT NOT NULL REFERENCES collections(root_path) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        system TEXT NOT NULL,
        extension TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        PRIMARY KEY (source_root, relative_path)
      );
      CREATE INDEX IF NOT EXISTS rom_files_source_system ON rom_files(source_root, system);
    `);
    const version = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    if (version.version !== 1) throw new Error(`Unsupported RetroHandler database schema version: ${version.version}`);
  }

  saveScan(result: ScanResult): void {
    const upsertCollection = this.db.prepare(`
      INSERT INTO collections(root_path, scanned_at, ignored, warnings_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(root_path) DO UPDATE SET scanned_at=excluded.scanned_at,
        ignored=excluded.ignored, warnings_json=excluded.warnings_json
    `);
    const existingRows = this.db.prepare(`
      SELECT id, name, system, relative_path, extension, bytes
      FROM rom_files WHERE source_root = ?
    `);
    const upsertRom = this.db.prepare(`
      INSERT INTO rom_files(source_root, relative_path, id, name, system, extension, bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_root, relative_path) DO UPDATE SET
        id=excluded.id, name=excluded.name, system=excluded.system,
        extension=excluded.extension, bytes=excluded.bytes
    `);
    const deleteRom = this.db.prepare('DELETE FROM rom_files WHERE source_root = ? AND relative_path = ?');
    const commit = this.db.transaction(() => {
      upsertCollection.run(result.source, result.scannedAt, result.ignored, JSON.stringify(result.warnings ?? []));
      const old = new Map((existingRows.all(result.source) as RomRow[]).map(row => [row.relative_path, row]));
      for (const game of result.games) {
        const previous = old.get(game.relativePath);
        old.delete(game.relativePath);
        if (previous && previous.id === game.id && previous.name === game.name &&
            previous.system === game.system && previous.extension === game.extension &&
            previous.bytes === game.bytes) continue;
        upsertRom.run(result.source, game.relativePath, game.id, game.name,
          game.system, game.extension, game.bytes);
      }
      // An unreadable directory could conceal files. Never erase them on a partial scan.
      if (!(result.warnings?.length)) {
        for (const relativePath of old.keys()) deleteRom.run(result.source, relativePath);
      }
    });
    commit();
  }

  loadLastScan(): ScanResult | null {
    const row = this.db.prepare(`
      SELECT root_path, scanned_at, ignored, warnings_json FROM collections
      ORDER BY scanned_at DESC, root_path ASC LIMIT 1
    `).get() as CollectionRow | undefined;
    if (!row) return null;
    const games = (this.db.prepare(`
      SELECT id, name, system, relative_path, extension, bytes
      FROM rom_files WHERE source_root = ? ORDER BY system, name, relative_path
    `).all(row.root_path) as RomRow[]).map((rom): Rom => ({
      id: rom.id, name: rom.name, system: rom.system, relativePath: rom.relative_path,
      extension: rom.extension, bytes: rom.bytes
    }));
    const warnings = JSON.parse(row.warnings_json) as ScanWarning[];
    return { source: row.root_path, games, ignored: row.ignored, scannedAt: row.scanned_at, warnings };
  }

  close(): void { this.db.close(); }
}
