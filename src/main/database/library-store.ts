import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { CollectionInfo, LibraryPage, LibraryQuery, Rom, ScanResult, ScanWarning, SystemCount } from '../../shared';

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
  listCollections?(): CollectionInfo[];
  queryLibrary?(query: LibraryQuery): LibraryPage;
  listSystems?(source: string | null): SystemCount[];
  renameCollection?(source: string, label: string): void;
  removeCollection?(source: string): void;
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
    if (version.version === 1) {
      const migrate = this.db.transaction(() => {
        this.db.exec('ALTER TABLE collections ADD COLUMN label TEXT');
        this.db.exec('UPDATE schema_version SET version = 2');
      });
      migrate();
    } else if (version.version !== 2) {
      throw new Error(`Unsupported RetroHandler database schema version: ${version.version}`);
    }
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

  listCollections(): CollectionInfo[] {
    const rows = this.db.prepare(`
      SELECT c.root_path AS rootPath, COALESCE(c.label, '') AS label,
        c.scanned_at AS scannedAt, c.ignored,
        (SELECT COUNT(*) FROM rom_files r WHERE r.source_root=c.root_path) AS gameCount,
        c.warnings_json AS warningsJson
      FROM collections c ORDER BY c.scanned_at DESC, c.root_path ASC
    `).all() as Array<Omit<CollectionInfo, 'warningCount'> & { warningsJson: string }>;
    return rows.map(row => ({ rootPath: row.rootPath, label: row.label || path.basename(row.rootPath) || row.rootPath,
      scannedAt: row.scannedAt, gameCount: row.gameCount, ignored: row.ignored,
      warningCount: (JSON.parse(row.warningsJson) as ScanWarning[]).length }));
  }

  queryLibrary(query: LibraryQuery): LibraryPage {
    if (!Number.isSafeInteger(query.offset) || query.offset < 0 ||
        !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200) {
      throw new Error('Invalid library page.');
    }
    const sortColumns: Record<LibraryQuery['sort'], string> = {
      name: 'r.name COLLATE NOCASE', system: 'r.system COLLATE NOCASE', bytes: 'r.bytes'
    };
    const order = sortColumns[query.sort];
    if (!order) throw new Error('Invalid sort order.');
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.source !== null) { clauses.push('r.source_root = ?'); params.push(query.source); }
    if (query.system !== null) { clauses.push('r.system = ?'); params.push(query.system); }
    if (query.search.trim()) {
      clauses.push("(r.name LIKE ? ESCAPE '!' OR r.relative_path LIKE ? ESCAPE '!')");
      const pattern = `%${query.search.trim().replace(/[!%_]/g, char => `!${char}`)}%`;
      params.push(pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = this.db.prepare(`SELECT COUNT(*) AS total FROM rom_files r ${where}`).get(...params) as { total: number };
    const rows = this.db.prepare(`
      SELECT r.source_root AS source, r.id, r.name, r.system,
        r.relative_path AS relativePath, r.extension, r.bytes
      FROM rom_files r ${where}
      ORDER BY ${order} ${query.descending ? 'DESC' : 'ASC'}, r.source_root ASC, r.relative_path ASC
      LIMIT ? OFFSET ?
    `).all(...params, query.limit, query.offset) as Array<{
      source: string; id: string; name: string; system: string;
      relativePath: string; extension: string; bytes: number;
    }>;
    return { items: rows, total: count.total };
  }

  listSystems(source: string | null): SystemCount[] {
    return (this.db.prepare(`
      SELECT system, COUNT(*) AS count FROM rom_files
      ${source === null ? '' : 'WHERE source_root = ?'}
      GROUP BY system ORDER BY system COLLATE NOCASE
    `).all(...(source === null ? [] : [source])) as SystemCount[]);
  }

  renameCollection(source: string, label: string): void {
    const newLabel = label.trim();
    if (!newLabel || newLabel.length > 120) throw new Error('Collection name must be 1–120 characters.');
    const result = this.db.prepare('UPDATE collections SET label=? WHERE root_path=?').run(newLabel, source);
    if (!result.changes) throw new Error('Collection not found.');
  }

  removeCollection(source: string): void {
    const result = this.db.prepare('DELETE FROM collections WHERE root_path=?').run(source);
    if (!result.changes) throw new Error('Collection not found.');
  }

  close(): void { this.db.close(); }
}
