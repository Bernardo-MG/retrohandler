import path from 'node:path';
import type {
  MetadataCandidate,
  BulkSystemSelection,
  CollectionInfo,
  GameMetadata,
  GameMetadataInput,
  IdentificationResult,
  IdentificationStatus,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
  Rom,
  ScanResult,
  ScanWarning,
  SystemCount
} from '../../shared';
import type { ParsedDat } from '../identification/dat';
import type { RomHashes } from '../identification/hashes';
import { openDatabase } from './database';
import { buildBulkTargetsQuery, buildLibraryQueries, buildSystemsQuery } from './library-query';
import { PreparedStatements, sql } from './query-loader';
import type {
  ArtworkRow,
  BulkTargetRow,
  CollectionListRow,
  CollectionRow,
  DatabaseFactory,
  DatabaseHandle,
  FingerprintMatchRow,
  FingerprintRow,
  LaunchBoxCandidateRow,
  LaunchBoxGame,
  LibraryRow,
  LibraryStore,
  RomRow
} from './types';

// Preserve the existing public API while the database internals are reorganized.
export type { DatabaseHandle, LibraryStore, LaunchBoxGame, Statement } from './types';

export function normalizeLaunchBoxName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The database is deliberately stored outside the ROM collection. */
export class SqliteLibraryStore implements LibraryStore {
  private readonly db: DatabaseHandle;
  private readonly statements: PreparedStatements;

  constructor(filePath: string, createDatabase?: DatabaseFactory) {
    this.db = openDatabase(filePath, createDatabase);
    this.statements = new PreparedStatements(this.db);
  }

  saveScan(result: ScanResult): void {
    const upsertCollection = this.statements.get('collections.upsertCollection');
    const existingRows = this.statements.get('roms.existingRows');
    const upsertRom = this.statements.get('roms.upsertRom');
    const deleteRom = this.statements.get('roms.deleteRom');
    const commit = this.db.transaction(() => {
      upsertCollection.run(result.source, result.scannedAt, result.ignored, JSON.stringify(result.warnings ?? []));
      const old = new Map((existingRows.all(result.source) as RomRow[]).map(row => [row.relative_path, row]));
      for (const game of result.games) {
        const previous = old.get(game.relativePath);
        old.delete(game.relativePath);
        if (previous && previous.id === game.id && previous.name === game.name &&
          previous.system === game.system && previous.extension === game.extension &&
          previous.bytes === game.bytes) {
          continue;
        }
        upsertRom.run(
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
          deleteRom.run(result.source, relativePath);
        }
      }
    });
    commit();
  }

  loadLastScan(): ScanResult | null {
    const row = this.statements.get('collections.lastScan').get() as CollectionRow | undefined;
    if (!row) {
      return null;
    }
    const games = (this.statements.get('roms.lastScanGames').all(row.root_path) as RomRow[]).map((rom): Rom => ({
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
    const rows = this.statements.get('collections.listCollections').all() as CollectionListRow[];
    return rows.map(row => ({
      rootPath: row.rootPath,
      label: row.label || path.basename(row.rootPath) || row.rootPath,
      scannedAt: row.scannedAt,
      gameCount: row.gameCount,
      ignored: row.ignored,
      warningCount: (JSON.parse(row.warningsJson) as ScanWarning[]).length
    }));
  }

  queryLibrary(query: LibraryQuery): LibraryPage {
    if (!Number.isSafeInteger(query.offset) || query.offset < 0 ||
      !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200) {
      throw new Error('Invalid library page.');
    }
    const { countSql, pageSql, params } = buildLibraryQueries(query);
    const count = this.db.prepare(countSql).get(...params) as {
      total: number
    };
    const rows = this.db.prepare(pageSql).all(...params, query.limit, query.offset) as LibraryRow[];
    return {
      items: rows.map(row => ({
        source: row.source,
        id: row.id,
        name: row.name,
        system: row.system,
        relativePath: row.relativePath,
        extension: row.extension,
        bytes: row.bytes,
        identificationStatus: row.identificationStatus ?? 'pending',
        identifiedTitle: row.identifiedTitle,
        datName: row.datName,
        metadata: row.metadataProvider ? {
          source: row.source,
          relativePath: row.relativePath,
          title: row.metadataTitle ?? '',
          description: row.metadataDescription ?? '',
          released: row.metadataReleased ?? '',
          developer: row.metadataDeveloper ?? '',
          publisher: row.metadataPublisher ?? '',
          genre: row.metadataGenre ?? '',
          provider: row.metadataProvider,
          providerId: row.metadataProviderId,
          providerSlug: row.metadataProviderSlug,
          artworkId: row.metadataArtworkId,
          systemOverride: row.metadataSystemOverride
        } : null
      })),
      total: count.total
    };
  }

  listSystems(source: string | null): SystemCount[] {
    const parameters = source === null ? [] : [source];
    return this.db.prepare(buildSystemsQuery(source)).all(...parameters) as SystemCount[];
  }

  renameCollection(source: string, label: string): void {
    const newLabel = label.trim();
    if (!newLabel || newLabel.length > 120) {
      throw new Error('Collection name must be 1–120 characters.');
    }
    const result = this.statements.get('collections.renameCollection').run(newLabel, source);
    if (!result.changes) {
      throw new Error('Collection not found.');
    }
  }

  removeCollection(source: string): void {
    const result = this.statements.get('collections.removeCollection').run(source);
    if (!result.changes) {
      throw new Error('Collection not found.');
    }
  }

  importDat(dat: ParsedDat): {
    name: string;
    count: number
  } {
    const replace = this.db.transaction(() => {
      // Reimport of a DAT with the same header replaces its entries atomically.
      this.statements.get('identification.insertDatSet').run(dat.name);
      const id = (this.statements.get('identification.findDatSet').get(dat.name) as {
        id: number
      }).id;
      this.statements.get('identification.deleteDatEntries').run(id);
      const insert = this.statements.get('identification.insertDatEntry');
      for (const row of dat.entries) {
        insert.run(id, row.game, row.file, row.size, row.crc32, row.md5, row.sha1);
      }
    });
    replace();
    return { name: dat.name, count: dat.entries.length };
  }

  entriesForIdentification(source: string): LibraryEntry[] {
    return this.statements.get('identification.entriesForIdentification').all(source) as LibraryEntry[];
  }

  cachedFingerprint(source: string, relativePath: string, size: number, modifiedMs: number): RomHashes | null {
    const row = this.statements.get('identification.cachedFingerprint').get(source, relativePath, size, modifiedMs) as FingerprintRow | undefined;
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
    const candidates = this.statements.get('identification.matchFingerprint').all(
      hashes.sha1,
      hashes.md5,
      hashes.size,
      hashes.sha1,
      hashes.md5,
      hashes.crc32
    ) as FingerprintMatchRow[];
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
    const save = this.statements.get('identification.saveIdentification');
    const commit = this.db.transaction(() => {
      for (const row of results) {
        const f = row.fingerprint;
        save.run(
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
    commit();
  }

  /** Only changes system_override. Existing descriptions, artwork and provider fields survive. */
  bulkAssignSystem(selection: BulkSystemSelection, value: string | null): number {
    if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value))) {
      throw new Error('Invalid system assignment.');
    }
    const systemOverride = value?.trim() ?? null;
    const update = this.statements.get('metadata.updateSystemOverride');
    const insert = this.statements.get('metadata.insertSystemOverride');
    const commit = this.db.transaction(() => {
      let targets: BulkTargetRow[];
      if (selection.scope === 'selected') {
        if (!Array.isArray(selection.targets) || selection.targets.length > 5000) {
          throw new Error('Too many selected ROMs.');
        }
        const find = this.statements.get('roms.findTarget');
        const keys = new Set<string>();
        targets = [];
        for (const target of selection.targets) {
          if (!target || typeof target.source !== 'string' || typeof target.relativePath !== 'string' ||
            target.source.length > 4096 || target.relativePath.length > 4096 || !target.source || !target.relativePath) {
            throw new Error('Invalid ROM target.');
          }
          const key = JSON.stringify([target.source, target.relativePath]);
          if (keys.has(key)) {
            continue;
          }
          keys.add(key);
          const row = find.get(target.source, target.relativePath) as BulkTargetRow | undefined;
          if (!row) {
            throw new Error('Selected ROM no longer exists. Refresh the library.');
          }
          targets.push(row);
        }
      } else if (selection.scope === 'filtered') {
        const q = selection.filter;
        if (!q || (q.source !== null && (typeof q.source !== 'string' || q.source.length > 4096)) ||
          typeof q.search !== 'string' || q.search.length > 256 ||
          (q.system !== null && (typeof q.system !== 'string' || q.system.length > 256)) ||
          (q.identification != null && !['pending', 'verified', 'probable', 'ambiguous', 'unknown', 'unsupported', 'error'].includes(q.identification))) {
          throw new Error('Invalid bulk filter.');
        }
        const { sql: targetSql, params } = buildBulkTargetsQuery(q);
        targets = this.db.prepare(targetSql).all(...params) as BulkTargetRow[];
        if (targets.length > 250000) {
          throw new Error('Too many matching ROMs; narrow the filter.');
        }
      } else {
        throw new Error('Invalid bulk selection.');
      }
      for (const target of targets) {
        // Clearing does not create unnecessary metadata records.
        if (systemOverride === null) {
          update.run(null, target.source, target.relativePath);
        }
        else {
          insert.run(target.source, target.relativePath, target.name || 'Untitled', systemOverride);
        }
      }
      return targets.length;
    });
    return commit();
  }

  /** Staged import: failed or cancelled XML leaves the previous catalogue intact. */
  beginLaunchBoxImport(): void {
    this.db.exec(sql('launchbox.clearStaging'));
  }

  addLaunchBoxGame(game: LaunchBoxGame): void {
    this.statements.get('launchbox.insertStagingGame').run(
      game.id,
      game.title,
      game.platform,
      game.released,
      game.description,
      game.developer,
      game.publisher,
      game.genre,
      normalizeLaunchBoxName(game.title)
    );
  }

  finishLaunchBoxImport(): number {
    const commit = this.db.transaction(() => {
      const count = (this.statements.get('launchbox.countStaging').get() as {
        n: number
      }).n;
      if (!count) {
        throw new Error('LaunchBox XML contains no usable game records.');
      }
      this.db.exec(sql('launchbox.publishStaging'));
      return count;
    });
    return commit();
  }

  abortLaunchBoxImport(): void {
    this.db.exec(sql('launchbox.clearStaging'));
  }

  searchLaunchBox(term: string, platform: string): MetadataCandidate[] {
    const normalized = normalizeLaunchBoxName(term);
    if (!normalized || normalized.length > 160) {
      throw new Error('Invalid LaunchBox search.');
    }
    // Prefix search uses the index; limit candidate work before ranking by platform.
    const escaped = normalized.replace(/[!%_]/g, c => `!${c}`);
    const candidates = this.statements.get('launchbox.search')
      .all(normalized, `${escaped}%`) as LaunchBoxCandidateRow[];
    const alias: Record<string, string> = {
      'supernintendo': 'supernintendoentertainmentsystem',
      'megadrivegenesis': 'segagenesis',
      'playstation': 'sonyplaystation',
      'gameboy': 'nintendogameboy',
      'gameboycolor': 'nintendogameboycolor',
      'gameboyadvance': 'nintendogameboyadvance',
      'nintendo64': 'nintendo64',
      'nintendoentertainmentsystem': 'nintendoentertainmentsystem'
    };
    const rawPlatform = platform.toLowerCase().replace(/[^a-z0-9]/g, '');
    const platformKey = alias[rawPlatform] ?? rawPlatform;
    return candidates.sort((a, b) => {
      const score = (v: typeof a) => (normalizeLaunchBoxName(v.title) === normalized ? 4 : 0) +
        (platformKey && (v.platform.toLowerCase().replace(/[^a-z0-9]/g, '') === platformKey ||
          v.platform.toLowerCase().replace(/[^a-z0-9]/g, '') === rawPlatform) ? 2 : 0);
      return score(b) - score(a) || a.title.localeCompare(b.title) || a.id - b.id;
    }).slice(
      0,
      20
    ).map(v => ({
      id: v.id,
      title: v.title,
      released: v.released,
      slug: null,
      platform: v.platform
    }));
  }

  getArtworkId(source: string, relativePath: string): string | null {
    const row = this.statements.get('metadata.getArtworkId').get(source, relativePath) as ArtworkRow | undefined;
    return row?.artworkId ?? null;
  }

  getLaunchBoxGame(id: number): LaunchBoxGame | null {
    return (this.statements.get('launchbox.getGame').get(id) as LaunchBoxGame | undefined) ?? null;
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
    const exists = this.statements.get('roms.exists').get(source, relativePath);
    if (!exists) {
      throw new Error('Game not found in the library.');
    }
    const previous = this.statements.get('metadata.getSystemOverride')
      .get(source, relativePath) as {
        systemOverride: string | null
      } | undefined;
    const systemOverride = metadata.systemOverride === undefined ? (previous?.systemOverride ?? null) : metadata.systemOverride?.trim() ?? null;
    const input = { ...metadata, title: metadata.title.trim(), systemOverride };
    this.statements.get('metadata.saveMetadata').run(
      source,
      relativePath,
      input.title,
      input.description,
      input.released,
      input.developer,
      input.publisher,
      input.genre,
      input.provider,
      input.providerId,
      input.providerSlug,
      input.artworkId,
      systemOverride
    );
    return { source, relativePath, ...input };
  }

  close(): void {
    this.db.close();
  }
}
