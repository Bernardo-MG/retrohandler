import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { MetadataCandidate, BulkSystemSelection, CollectionInfo, GameMetadata, GameMetadataInput, IdentificationResult, IdentificationStatus, LibraryEntry, LibraryPage, LibraryQuery, Rom, ScanResult, ScanWarning, SystemCount } from '../../shared';
import type { DatEntry, ParsedDat } from '../identification/dat';
import type { RomHashes, } from '../identification/hashes';

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

export interface LaunchBoxGame { id: number; title: string; platform: string; released: string; description: string; developer: string; publisher: string; genre: string; }

export function normalizeLaunchBoxName(name: string): string { return name.trim().toLowerCase().replace(/\s+/g,' '); }

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
  importDat?(dat: ParsedDat): { name: string; count: number };
  entriesForIdentification?(source: string): LibraryEntry[];
  cachedFingerprint?(source: string, relativePath: string, size: number, modifiedMs: number): RomHashes | null;
  matchFingerprint?(hashes: RomHashes): { status: IdentificationStatus; title: string | null; datName: string | null };
  saveIdentification?(source: string, results: IdentificationResult[]): void;
  saveMetadata?(source: string, relativePath: string, metadata: GameMetadataInput): GameMetadata;
  bulkAssignSystem?(selection: BulkSystemSelection, systemOverride: string | null): number;
  beginLaunchBoxImport?(): void;
  addLaunchBoxGame?(game: LaunchBoxGame): void;
  finishLaunchBoxImport?(): number;
  abortLaunchBoxImport?(): void;
  searchLaunchBox?(query: string, system: string): MetadataCandidate[];
  getLaunchBoxGame?(id: number): LaunchBoxGame | null;
  getArtworkId?(source: string, relativePath: string): string | null;
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
    } else if (version.version !== 2 && version.version !== 3 && version.version !== 4 && version.version !== 5 && version.version !== 6) {
      throw new Error(`Unsupported RetroHandler database schema version: ${version.version}`);
    }
    const current = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number };
    if (current.version === 2) {
      const migrate = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE dat_sets(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
          CREATE TABLE dat_entries(
            dat_id INTEGER NOT NULL REFERENCES dat_sets(id) ON DELETE CASCADE,
            game TEXT NOT NULL, filename TEXT NOT NULL, bytes INTEGER NOT NULL,
            crc32 TEXT, md5 TEXT, sha1 TEXT
          );
          CREATE INDEX dat_entries_sha1 ON dat_entries(sha1, bytes);
          CREATE INDEX dat_entries_md5 ON dat_entries(md5, bytes);
          CREATE INDEX dat_entries_crc ON dat_entries(crc32, bytes);
          CREATE TABLE rom_identifications(
            source_root TEXT NOT NULL, relative_path TEXT NOT NULL,
            status TEXT NOT NULL, title TEXT, dat_name TEXT,
            bytes INTEGER, modified_ms REAL, crc32 TEXT, md5 TEXT, sha1 TEXT,
            PRIMARY KEY(source_root, relative_path),
            FOREIGN KEY(source_root, relative_path)
              REFERENCES rom_files(source_root, relative_path) ON DELETE CASCADE
          );
          UPDATE schema_version SET version = 3;
        `);
      });
      migrate();
    }
    const schema = (this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number }).version;
    if (schema === 3) {
      const migrate = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE rom_metadata (
            source_root TEXT NOT NULL, relative_path TEXT NOT NULL,
            title TEXT NOT NULL, description TEXT NOT NULL, released TEXT NOT NULL,
            developer TEXT NOT NULL, publisher TEXT NOT NULL, genre TEXT NOT NULL,
            provider TEXT NOT NULL, provider_id TEXT, provider_slug TEXT, artwork_id TEXT,
            PRIMARY KEY (source_root, relative_path),
            FOREIGN KEY (source_root, relative_path)
              REFERENCES rom_files(source_root, relative_path) ON DELETE CASCADE
          );
          UPDATE schema_version SET version = 4;
        `);
      });
      migrate();
    }
    // Patch 007.1: keep scanner classification intact; store a nullable manual override.
    const metadataSchema = (this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number }).version;
    if (metadataSchema === 4) {
      const migrate = this.db.transaction(() => {
        this.db.exec('ALTER TABLE rom_metadata ADD COLUMN system_override TEXT');
        this.db.exec('UPDATE schema_version SET version = 5');
      });
      migrate();
    }
    // Retire unsupported metadata providers without discarding user-entered details or artwork.
    const providerSchema = (this.db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number }).version;
    if (providerSchema === 5) {
      const migrate = this.db.transaction(() => {
        this.db.exec(`UPDATE rom_metadata SET provider='manual', provider_id=NULL, provider_slug=NULL
          WHERE provider NOT IN ('manual', 'launchbox');
          UPDATE schema_version SET version = 6;`);
      });
      migrate();
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
      name: 'r.name COLLATE NOCASE', system: "COALESCE(NULLIF(m.system_override, ''), r.system) COLLATE NOCASE", bytes: 'r.bytes'
    };
    const order = sortColumns[query.sort];
    if (!order) throw new Error('Invalid sort order.');
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.source !== null) { clauses.push('r.source_root = ?'); params.push(query.source); }
    if (query.system !== null) { clauses.push("COALESCE(NULLIF(m.system_override, ''), r.system) = ?"); params.push(query.system); }
    if (query.search.trim()) {
      clauses.push("(r.name LIKE ? ESCAPE '!' OR r.relative_path LIKE ? ESCAPE '!')");
      const pattern = `%${query.search.trim().replace(/[!%_]/g, char => `!${char}`)}%`;
      params.push(pattern, pattern);
    }
    if (query.identification) {
      if (!['pending','verified','probable','ambiguous','unknown','unsupported','error'].includes(query.identification)) throw new Error('Invalid identification filter.');
      clauses.push(query.identification === 'pending' ? 'NOT EXISTS (SELECT 1 FROM rom_identifications x WHERE x.source_root=r.source_root AND x.relative_path=r.relative_path)' : 'EXISTS (SELECT 1 FROM rom_identifications x WHERE x.source_root=r.source_root AND x.relative_path=r.relative_path AND x.status=?)');
      if (query.identification !== 'pending') params.push(query.identification);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = this.db.prepare(`SELECT COUNT(*) AS total FROM rom_files r
      LEFT JOIN rom_metadata m ON m.source_root=r.source_root AND m.relative_path=r.relative_path ${where}`).get(...params) as { total: number };
    const rows = this.db.prepare(`
      SELECT r.source_root AS source, r.id, r.name,
        COALESCE(NULLIF(m.system_override, ''), r.system) AS system,
        r.relative_path AS relativePath, r.extension, r.bytes,
        i.status AS identificationStatus, i.title AS identifiedTitle, i.dat_name AS datName,
        m.title AS metadataTitle, m.description AS metadataDescription, m.released AS metadataReleased,
        m.developer AS metadataDeveloper, m.publisher AS metadataPublisher, m.genre AS metadataGenre,
        m.provider AS metadataProvider, m.provider_id AS metadataProviderId,
        m.provider_slug AS metadataProviderSlug, m.artwork_id AS metadataArtworkId,
        m.system_override AS metadataSystemOverride
      FROM rom_files r LEFT JOIN rom_identifications i
        ON i.source_root=r.source_root AND i.relative_path=r.relative_path
      LEFT JOIN rom_metadata m ON m.source_root=r.source_root AND m.relative_path=r.relative_path ${where}
      ORDER BY ${order} ${query.descending ? 'DESC' : 'ASC'}, r.source_root ASC, r.relative_path ASC
      LIMIT ? OFFSET ?
    `).all(...params, query.limit, query.offset) as Array<{
      source: string; id: string; name: string; system: string;
      relativePath: string; extension: string; bytes: number;
      identificationStatus: IdentificationStatus | null; identifiedTitle: string | null; datName: string | null;
      metadataTitle: string | null; metadataDescription: string | null; metadataReleased: string | null;
      metadataDeveloper: string | null; metadataPublisher: string | null; metadataGenre: string | null;
      metadataProvider: 'manual' | 'launchbox' | null; metadataProviderId: string | null;
      metadataProviderSlug: string | null; metadataArtworkId: string | null; metadataSystemOverride: string | null;
    }>;
    return { items: rows.map(row => ({
      source: row.source, id: row.id, name: row.name, system: row.system,
      relativePath: row.relativePath, extension: row.extension, bytes: row.bytes,
      identificationStatus: row.identificationStatus ?? 'pending', identifiedTitle: row.identifiedTitle, datName: row.datName,
      metadata: row.metadataProvider ? {
        source: row.source, relativePath: row.relativePath, title: row.metadataTitle ?? '',
        description: row.metadataDescription ?? '', released: row.metadataReleased ?? '',
        developer: row.metadataDeveloper ?? '', publisher: row.metadataPublisher ?? '', genre: row.metadataGenre ?? '',
        provider: row.metadataProvider, providerId: row.metadataProviderId,
        providerSlug: row.metadataProviderSlug, artworkId: row.metadataArtworkId, systemOverride: row.metadataSystemOverride
      } : null
    })), total: count.total };
  }

  listSystems(source: string | null): SystemCount[] {
    return (this.db.prepare(`
      SELECT COALESCE(NULLIF(m.system_override, ''), r.system) AS system, COUNT(*) AS count
      FROM rom_files r LEFT JOIN rom_metadata m
        ON m.source_root=r.source_root AND m.relative_path=r.relative_path
      ${source === null ? '' : 'WHERE r.source_root = ?'}
      GROUP BY COALESCE(NULLIF(m.system_override, ''), r.system) ORDER BY system COLLATE NOCASE
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

  importDat(dat: ParsedDat): { name: string; count: number } {
    const replace = this.db.transaction(() => {
      // Reimport of a DAT with the same header replaces its entries atomically.
      this.db.prepare('INSERT INTO dat_sets(name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(dat.name);
      const id = (this.db.prepare('SELECT id FROM dat_sets WHERE name=?').get(dat.name) as { id: number }).id;
      this.db.prepare('DELETE FROM dat_entries WHERE dat_id=?').run(id);
      const insert = this.db.prepare('INSERT INTO dat_entries(dat_id, game, filename, bytes, crc32, md5, sha1) VALUES(?, ?, ?, ?, ?, ?, ?)');
      for (const row of dat.entries) insert.run(id, row.game, row.file, row.size, row.crc32, row.md5, row.sha1);
    });
    replace();
    return { name: dat.name, count: dat.entries.length };
  }

  entriesForIdentification(source: string): LibraryEntry[] {
    return this.db.prepare(`SELECT source_root AS source, relative_path AS relativePath,
      id, name, system, extension, bytes FROM rom_files WHERE source_root=?
      ORDER BY relative_path ASC`).all(source) as LibraryEntry[];
  }

  cachedFingerprint(source: string, relativePath: string, size: number, modifiedMs: number): RomHashes | null {
    const row = this.db.prepare(`SELECT bytes, modified_ms AS modifiedMs, crc32, md5, sha1
      FROM rom_identifications WHERE source_root=? AND relative_path=?
      AND bytes=? AND modified_ms=? AND sha1 IS NOT NULL`).get(source, relativePath, size, modifiedMs) as
      { bytes: number; modifiedMs: number; crc32: string; md5: string; sha1: string } | undefined;
    return row ? { size: row.bytes, modifiedMs: row.modifiedMs, crc32: row.crc32, md5: row.md5, sha1: row.sha1 } : null;
  }

  matchFingerprint(hashes: RomHashes): { status: IdentificationStatus; title: string | null; datName: string | null } {
    // SHA1 and MD5 are strong match evidence. CRC32 is weaker and always "probable".
    const candidates = this.db.prepare(`
      SELECT d.game, s.name AS datName,
        CASE WHEN d.sha1=? THEN 'sha1' WHEN d.md5=? THEN 'md5' ELSE 'crc' END AS evidence
      FROM dat_entries d JOIN dat_sets s ON s.id=d.dat_id
      WHERE d.bytes=? AND (d.sha1=? OR d.md5=? OR d.crc32=?)
    `).all(hashes.sha1, hashes.md5, hashes.size, hashes.sha1, hashes.md5, hashes.crc32) as
      Array<{game: string; datName: string; evidence: string}>;
    if (!candidates.length) return { status: 'unknown', title: null, datName: null };
    const best = candidates.filter(row => row.evidence === 'sha1');
    const matches = best.length ? best : candidates.filter(row => row.evidence === 'md5');
    const selected = matches.length ? matches : candidates;
    if (new Set(selected.map(row => row.game)).size > 1) return { status: 'ambiguous', title: null, datName: null };
    return { status: selected[0].evidence === 'crc' ? 'probable' : 'verified', title: selected[0].game, datName: selected[0].datName };
  }

  saveIdentification(source: string, results: IdentificationResult[]): void {
    const save = this.db.prepare(`INSERT INTO rom_identifications(
      source_root, relative_path, status, title, dat_name, bytes, modified_ms, crc32, md5, sha1)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_root, relative_path) DO UPDATE SET status=excluded.status,
      title=excluded.title, dat_name=excluded.dat_name, bytes=excluded.bytes,
      modified_ms=excluded.modified_ms, crc32=excluded.crc32, md5=excluded.md5, sha1=excluded.sha1`);
    const commit = this.db.transaction(() => {
      for (const row of results) {
        const f = row.fingerprint;
        save.run(source, row.relativePath, row.status, row.title, row.datName,
          f?.size ?? null, f?.modifiedMs ?? null, f?.crc32 ?? null, f?.md5 ?? null, f?.sha1 ?? null);
      }
    });
    commit();
  }

  /** Only changes system_override. Existing descriptions, artwork and provider fields survive. */
  bulkAssignSystem(selection: BulkSystemSelection, value: string | null): number {
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value))) {
      throw new Error('Invalid system assignment.');
    }
    const systemOverride = value?.trim() ?? null;
    const update = this.db.prepare('UPDATE rom_metadata SET system_override=? WHERE source_root=? AND relative_path=?');
    const insert = this.db.prepare(`INSERT INTO rom_metadata(source_root, relative_path, title, description,
      released, developer, publisher, genre, provider, provider_id, provider_slug, artwork_id, system_override)
      VALUES(?, ?, ?, '', '', '', '', '', 'manual', NULL, NULL, NULL, ?)
      ON CONFLICT(source_root, relative_path) DO UPDATE SET system_override=excluded.system_override`);
    const commit = this.db.transaction(() => {
      let targets: Array<{ source: string; relativePath: string; name: string }>;
      if (selection.scope === 'selected') {
        if (!Array.isArray(selection.targets) || selection.targets.length > 5000) throw new Error('Too many selected ROMs.');
        const find = this.db.prepare(`SELECT source_root AS source, relative_path AS relativePath, name
          FROM rom_files WHERE source_root=? AND relative_path=?`);
        const keys = new Set<string>();
        targets = [];
        for (const target of selection.targets) {
          if (!target || typeof target.source !== 'string' || typeof target.relativePath !== 'string' ||
              target.source.length > 4096 || target.relativePath.length > 4096 || !target.source || !target.relativePath) throw new Error('Invalid ROM target.');
          const key = JSON.stringify([target.source, target.relativePath]);
          if (keys.has(key)) continue;
          keys.add(key);
          const row = find.get(target.source, target.relativePath) as typeof targets[number] | undefined;
          if (!row) throw new Error('Selected ROM no longer exists. Refresh the library.');
          targets.push(row);
        }
      } else if (selection.scope === 'filtered') {
        const q = selection.filter;
        if (!q || (q.source !== null && (typeof q.source !== 'string' || q.source.length > 4096)) ||
            typeof q.search !== 'string' || q.search.length > 256 ||
            (q.system !== null && (typeof q.system !== 'string' || q.system.length > 256)) ||
            (q.identification != null && !['pending','verified','probable','ambiguous','unknown','unsupported','error'].includes(q.identification))) {
          throw new Error('Invalid bulk filter.');
        }
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (q.source !== null) { clauses.push('r.source_root=?'); params.push(q.source); }
        if (q.system !== null) {
          clauses.push("COALESCE(NULLIF(m.system_override, ''), r.system)=?"); params.push(q.system);
        }
        if (q.search.trim()) {
          clauses.push("(r.name LIKE ? ESCAPE '!' OR r.relative_path LIKE ? ESCAPE '!')");
          const term = `%${q.search.trim().replace(/[!%_]/g, c => `!${c}`)}%`;
          params.push(term, term);
        }
        if (q.identification) {
          if (q.identification === 'pending') clauses.push(`NOT EXISTS (SELECT 1 FROM rom_identifications i
            WHERE i.source_root=r.source_root AND i.relative_path=r.relative_path)`);
          else {
            clauses.push(`EXISTS (SELECT 1 FROM rom_identifications i WHERE i.source_root=r.source_root
              AND i.relative_path=r.relative_path AND i.status=?)`);
            params.push(q.identification);
          }
        }
        targets = this.db.prepare(`SELECT r.source_root AS source, r.relative_path AS relativePath, r.name
          FROM rom_files r LEFT JOIN rom_metadata m ON m.source_root=r.source_root
            AND m.relative_path=r.relative_path ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
          ORDER BY r.source_root, r.relative_path LIMIT 250001`).all(...params) as typeof targets;
        if (targets.length > 250000) throw new Error('Too many matching ROMs; narrow the filter.');
      } else throw new Error('Invalid bulk selection.');
      for (const target of targets) {
        // Clearing does not create unnecessary metadata records.
        if (systemOverride === null) update.run(null, target.source, target.relativePath);
        else insert.run(target.source, target.relativePath, target.name || 'Untitled', systemOverride);
      }
      return targets.length;
    });
    return commit();
  }

  /** Staged import: a failed or cancelled XML parse leaves the previous catalogue intact. */
  private launchboxSchema(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS launchbox_games (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL,
      released TEXT NOT NULL, description TEXT NOT NULL, developer TEXT NOT NULL,
      publisher TEXT NOT NULL, genre TEXT NOT NULL, normalized_title TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS launchbox_lookup ON launchbox_games(normalized_title);
      CREATE TABLE IF NOT EXISTS launchbox_staging (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL,
      released TEXT NOT NULL, description TEXT NOT NULL, developer TEXT NOT NULL,
      publisher TEXT NOT NULL, genre TEXT NOT NULL, normalized_title TEXT NOT NULL);`);
  }
  beginLaunchBoxImport(): void {
    this.launchboxSchema();
    this.db.exec('DELETE FROM launchbox_staging');
  }
  addLaunchBoxGame(game: LaunchBoxGame): void {
    this.db.prepare(`INSERT OR REPLACE INTO launchbox_staging
      (id,title,platform,released,description,developer,publisher,genre,normalized_title)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(game.id, game.title, game.platform, game.released,
      game.description, game.developer, game.publisher, game.genre, normalizeLaunchBoxName(game.title));
  }
  finishLaunchBoxImport(): number {
    const commit = this.db.transaction(() => {
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM launchbox_staging').get() as {n:number}).n;
      if (!count) throw new Error('LaunchBox XML contains no usable game records.');
      this.db.exec('DELETE FROM launchbox_games; INSERT INTO launchbox_games SELECT * FROM launchbox_staging; DELETE FROM launchbox_staging;');
      return count;
    });
    return commit();
  }
  abortLaunchBoxImport(): void { this.db.exec('DELETE FROM launchbox_staging'); }
  searchLaunchBox(term: string, platform: string): MetadataCandidate[] {
    this.launchboxSchema();
    const normalized = normalizeLaunchBoxName(term);
    if (!normalized || normalized.length > 160) throw new Error('Invalid LaunchBox search.');
    // Prefix search uses the index; limit candidate work before ranking by platform.
    const escaped = normalized.replace(/[!%_]/g, c => `!${c}`);
    const candidates = this.db.prepare(`SELECT id,title,platform,released FROM launchbox_games
      WHERE normalized_title = ? OR normalized_title LIKE ? ESCAPE '!' LIMIT 300`)
      .all(normalized, `${escaped}%`) as Array<{id:number;title:string;platform:string;released:string}>;
    const alias: Record<string,string> = {
      'supernintendo':'supernintendoentertainmentsystem',
      'megadrivegenesis':'segagenesis','playstation':'sonyplaystation',
      'gameboy':'nintendogameboy','gameboycolor':'nintendogameboycolor',
      'gameboyadvance':'nintendogameboyadvance',
      'nintendo64':'nintendo64', 'nintendoentertainmentsystem':'nintendoentertainmentsystem'
    };
    const rawPlatform = platform.toLowerCase().replace(/[^a-z0-9]/g,'');
    const platformKey = alias[rawPlatform] ?? rawPlatform;
    return candidates.sort((a,b) => {
      const score = (v: typeof a) => (normalizeLaunchBoxName(v.title) === normalized ? 4 : 0) +
        (platformKey && (v.platform.toLowerCase().replace(/[^a-z0-9]/g,'') === platformKey ||
          v.platform.toLowerCase().replace(/[^a-z0-9]/g,'') === rawPlatform) ? 2 : 0);
      return score(b)-score(a) || a.title.localeCompare(b.title) || a.id-b.id;
    }).slice(0,20).map(v => ({id:v.id,title:v.title,released:v.released,slug:null,platform:v.platform}));
  }
  getArtworkId(source: string, relativePath: string): string | null {
    return (this.db.prepare(`SELECT artwork_id AS artworkId FROM rom_metadata WHERE source_root=? AND relative_path=?`)
      .get(source,relativePath) as {artworkId:string|null}|undefined)?.artworkId ?? null;
  }
  getLaunchBoxGame(id: number): LaunchBoxGame | null {
    this.launchboxSchema();
    return (this.db.prepare(`SELECT id,title,platform,released,description,developer,publisher,genre
      FROM launchbox_games WHERE id=?`).get(id) as LaunchBoxGame | undefined) ?? null;
  }

  saveMetadata(source: string, relativePath: string, metadata: GameMetadataInput): GameMetadata {
    if (!metadata.title.trim() || metadata.title.length > 200 || metadata.description.length > 4000 ||
        [metadata.released, metadata.developer, metadata.publisher, metadata.genre].some(value => value.length > 200) ||
        !['manual', 'launchbox'].includes(metadata.provider) ||
        (metadata.providerId !== null && metadata.providerId.length > 80) ||
        (metadata.providerSlug !== null && !/^[a-z0-9-]{1,150}$/.test(metadata.providerSlug)) ||
        (metadata.artworkId !== null && !/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(metadata.artworkId)) ||
        (metadata.systemOverride !== undefined && metadata.systemOverride !== null &&
          (typeof metadata.systemOverride !== 'string' || !metadata.systemOverride.trim() ||
          metadata.systemOverride.length > 120 || /[\x00-\x1f]/.test(metadata.systemOverride)))) {
      throw new Error('Invalid game metadata.');
    }
    // FK guarantees that the target is an indexed ROM. Never writes to ROM folders.
    const exists = this.db.prepare('SELECT 1 AS found FROM rom_files WHERE source_root=? AND relative_path=?').get(source, relativePath);
    if (!exists) throw new Error('Game not found in the library.');
    const previous = this.db.prepare('SELECT system_override AS systemOverride FROM rom_metadata WHERE source_root=? AND relative_path=?')
      .get(source, relativePath) as { systemOverride: string | null } | undefined;
    const systemOverride = metadata.systemOverride === undefined ? (previous?.systemOverride ?? null) : metadata.systemOverride?.trim() ?? null;
    const input = { ...metadata, title: metadata.title.trim(), systemOverride };
    this.db.prepare(`INSERT INTO rom_metadata(source_root, relative_path, title, description, released,
      developer, publisher, genre, provider, provider_id, provider_slug, artwork_id, system_override)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_root, relative_path) DO UPDATE SET title=excluded.title,
      description=excluded.description, released=excluded.released, developer=excluded.developer,
      publisher=excluded.publisher, genre=excluded.genre, provider=excluded.provider,
      provider_id=excluded.provider_id, provider_slug=excluded.provider_slug, artwork_id=excluded.artwork_id,
      system_override=excluded.system_override`).run(
        source, relativePath, input.title, input.description, input.released,
        input.developer, input.publisher, input.genre, input.provider,
        input.providerId, input.providerSlug, input.artworkId, systemOverride);
    return { source, relativePath, ...input };
  }

  close(): void { this.db.close(); }
}
