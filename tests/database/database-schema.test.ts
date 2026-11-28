import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { DatabaseHandle, Statement } from '../../src/main/database/sql/types';
import { openTestRepositories, type TestRepositories } from '../helpers/database';
import { SCHEMA_VERSION } from '../../src/main/database/schema';
import { PreparedStatements } from '../../src/main/database/sql/prepared-statements';
import { QueryRegistry } from '../../src/main/database/sql/query-registry';
import type { LibraryQuery, ScanResult } from '../../src/shared';

function adapter(file: string): DatabaseHandle {
  const db = new DatabaseSync(file);
  return {
    pragma: (value) => db.exec(`PRAGMA ${value}`),
    exec: (value) => db.exec(value),
    prepare: (value) => db.prepare(value) as Statement,
    transaction: (fn) => () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close()
  };
}

function fixture(run: (file: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-schema-'));
  try {
    run(path.join(root, 'library.sqlite'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function raw(file: string, run: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(file);
  try {
    run(db);
  } finally {
    db.close();
  }
}

function useStore(file: string, run: (store: TestRepositories) => void): void {
  const store = openTestRepositories(file, adapter);
  try {
    run(store);
  } finally {
    store.database.close();
  }
}

const SOURCE = 'C:/roms';
const ARTWORK = `${'a'.repeat(64)}.png`;
const HASHES = {
  size: 3,
  modifiedMs: 123,
  sha1: 'a'.repeat(40),
  md5: 'b'.repeat(32),
  crc32: 'c'.repeat(8)
};
const GAME = {
  id: 1,
  title: 'Example',
  platform: 'NES',
  released: '1991',
  description: 'Catalogue',
  developer: '',
  publisher: '',
  genre: ''
};
const scan: ScanResult = {
  source: SOURCE,
  scannedAt: '2026-01-01T00:00:00Z',
  ignored: 0,
  games: [
    {
      id: 'a',
      name: 'Game_1',
      system: 'NES',
      relativePath: 'a.nes',
      extension: '.nes',
      bytes: 3
    },
    {
      id: 'b',
      name: 'Game-1',
      system: 'NES',
      relativePath: 'b.nes',
      extension: '.nes',
      bytes: 5
    }
  ]
};
const query = (overrides: Partial<LibraryQuery> = {}): LibraryQuery => ({
  source: null,
  system: null,
  search: '',
  sort: 'name',
  descending: false,
  offset: 0,
  limit: 20,
  ...overrides
});

function populate(file: string): void {
  useStore(file, (store) => {
    store.collections.saveScan(scan);
    store.collections.renameCollection(SOURCE, 'My collection');
    store.identification.importDat({
      name: 'DAT',
      entries: [
        {
          game: 'Matched',
          file: 'a.nes',
          size: HASHES.size,
          sha1: HASHES.sha1,
          md5: HASHES.md5,
          crc32: HASHES.crc32
        }
      ]
    });
    store.identification.saveIdentification(SOURCE, [
      {
        source: SOURCE,
        relativePath: 'a.nes',
        status: 'verified',
        title: 'Matched',
        datName: 'DAT',
        fingerprint: HASHES
      }
    ]);
    store.metadata.saveMetadata(SOURCE, 'a.nes', {
      title: 'Manual title',
      description: 'Keep this',
      released: '1992',
      developer: '',
      publisher: '',
      genre: '',
      provider: 'launchbox',
      providerId: '1',
      providerSlug: null,
      artworkId: ARTWORK,
      systemOverride: 'SNES'
    });
    store.launchBox.beginLaunchBoxImport();
    store.launchBox.addLaunchBoxGame(GAME);
    assert.equal(store.launchBox.finishLaunchBoxImport(), 1);
  });
}

const TABLES = [
  'collections',
  'dat_entries',
  'dat_sets',
  'launchbox_games',
  'launchbox_staging',
  'rom_files',
  'rom_identifications',
  'rom_metadata'
];

function assertCanonical(file: string): void {
  raw(file, (db) => {
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name"
      )
      .all();
    assert.deepEqual(
      tables.map((row) => row.name),
      TABLES
    );
    const metadataColumns = db.prepare('PRAGMA table_info(rom_metadata)').all();
    assert.ok(metadataColumns.some((column) => column.name === 'system_override'));
    assert.ok(
      db
        .prepare('PRAGMA table_info(collections)')
        .all()
        .some((column) => column.name === 'label')
    );
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  });
}

test('fresh database creates the complete initial schema at version 1', () =>
  fixture((file) => {
    const statements: string[] = [];
    const store = openTestRepositories(file, (filename) => {
      const db = adapter(filename);
      const exec = db.exec.bind(db);
      db.exec = (value) => {
        statements.push(value);
        exec(value);
      };
      return db;
    });
    store.database.close();
    assert.equal(SCHEMA_VERSION, 1);
    assert.equal(statements.length, 1);
    assert.ok(!statements[0].includes('ALTER TABLE'));
    assertCanonical(file);
  }));

test('reopening the initial schema preserves records without executing schema DDL', () =>
  fixture((file) => {
    populate(file);
    const store = openTestRepositories(file, (filename) => {
      const db = adapter(filename);
      db.exec = () => {
        throw new Error('Existing databases must not execute schema DDL');
      };
      return db;
    });
    try {
      assert.equal(store.roms.queryLibrary(query()).total, 2);
      assert.equal(store.collections.listCollections()[0].label, 'My collection');
      assert.equal(store.identification.matchFingerprint(HASHES).title, 'Matched');
      assert.equal(store.metadata.getArtworkId(SOURCE, 'a.nes'), ARTWORK);
      const game = store.roms.queryLibrary(query()).items.find((entry) => entry.relativePath === 'a.nes');
      assert.equal(game?.identificationStatus, 'verified');
      assert.equal(game?.metadata?.description, 'Keep this');
      assert.equal(game?.metadata?.providerId, '1');
      assert.equal(game?.system, 'SNES');
      assert.equal(store.launchBox.getLaunchBoxGame(1)?.title, GAME.title);
    } finally {
      store.database.close();
    }
    assertCanonical(file);
  }));

for (const version of [1, 6]) {
  test(`pre-release database version ${version} is rejected without overwriting records`, () =>
    fixture((file) => {
      raw(file, (db) => {
        db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); CREATE TABLE saved (value TEXT);');
        db.prepare('INSERT INTO schema_version VALUES (?)').run(version);
        db.prepare('INSERT INTO saved VALUES (?)').run('keep');
      });
      assert.throws(() => openTestRepositories(file, adapter), /Pre-release RetroHandler database/);
      raw(file, (db) => {
        assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version, version);
        assert.equal(db.prepare('SELECT value FROM saved').get()?.value, 'keep');
        assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0);
        assert.equal(
          db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'collections'").get()?.n,
          0
        );
      });
    }));
}

test('future and unversioned nonempty databases are rejected without creating schema tables', () =>
  fixture((file) => {
    raw(file, (db) => db.exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('keep')"));
    assert.throws(() => openTestRepositories(file, adapter), /unversioned, nonempty/);
    raw(file, (db) => db.exec('PRAGMA user_version = 99'));
    assert.throws(() => openTestRepositories(file, adapter), /Unsupported.*99/);
    raw(file, (db) => {
      assert.equal(db.prepare('SELECT value FROM unrelated').get()?.value, 'keep');
      assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 99);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'collections'").get()?.n,
        0
      );
    });
  }));

test('failed initial version assignment rolls back schema creation and can be retried', () =>
  fixture((file) => {
    assert.throws(
      () =>
        openTestRepositories(file, (filename) => {
          const db = adapter(filename);
          const pragma = db.pragma.bind(db);
          db.pragma = (value) => {
            if (value.startsWith('user_version = ')) {
              throw new Error('Simulated version assignment failure');
            }
            return pragma(value);
          };
          return db;
        }),
      /Simulated version assignment failure/
    );
    raw(file, (db) => {
      assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").get()?.n,
        0
      );
    });
    useStore(file, () => undefined);
    assertCanonical(file);
  }));

test('browse and bulk system assignment use identical bound filters', () =>
  fixture((file) => {
    populate(file);
    useStore(file, (store) => {
      const filter = {
        source: SOURCE,
        system: 'SNES',
        search: '_',
        identification: 'verified' as const
      };
      assert.equal(store.roms.queryLibrary(query(filter)).total, 1);
      assert.equal(store.metadata.bulkAssignSystem({ scope: 'filtered', filter }, 'Game Boy'), 1);
      assert.equal(store.roms.queryLibrary(query({ system: 'Game Boy', search: '_' })).total, 1);
      assert.equal(store.roms.queryLibrary(query({ identification: 'pending' })).total, 1);
      assert.equal(store.roms.queryLibrary(query({ search: "%' OR 1=1 --" })).total, 0);
      assert.throws(
        () => store.roms.queryLibrary(query({ sort: 'constructor' as LibraryQuery['sort'] })),
        /Invalid sort order/
      );
      assert.equal(store.roms.queryLibrary(query()).total, 2);
      assert.equal(store.roms.listSystems(SOURCE).find((row) => row.system === 'Game Boy')?.count, 1);
      assert.equal(store.metadata.getArtworkId(SOURCE, 'a.nes'), ARTWORK);
    });
  }));

test('prepared statement cache reuses static statements and rejects incomplete templates', () =>
  fixture((file) => {
    useStore(file, () => undefined);
    const db = adapter(file);
    try {
      const registry = new QueryRegistry();
      registry.loadDirectory(path.join(__dirname, '../../src/main/database/queries'));
      const statements = new PreparedStatements(db, registry);
      assert.equal(
        statements.get('collections.listCollections'),
        statements.get('collections.listCollections')
      );
      assert.throws(() => statements.get('library.pageGames'), /requires explicit fragments/);
      assert.throws(() => registry.render('library.pageGames', { where: '' }), /Missing SQL fragment/);
      assert.throws(
        () => registry.render('library.countGames', { where: '', extra: '' }),
        /Invalid SQL template fragments/
      );
      assert.equal(statements.get('collections.listCollections').all().length, 0);
    } finally {
      db.close();
    }
  }));

test('metadata edits, fingerprint cache, catalogue cancellation and cascade deletion retain their behavior', () =>
  fixture((file) => {
    populate(file);
    useStore(file, (store) => {
      assert.deepEqual(
        store.identification.cachedFingerprint(SOURCE, 'a.nes', HASHES.size, HASHES.modifiedMs),
        HASHES
      );
      assert.equal(
        store.identification.cachedFingerprint(SOURCE, 'a.nes', HASHES.size, HASHES.modifiedMs + 1),
        null
      );
      assert.equal(store.identification.entriesForIdentification(SOURCE).length, 2);
      const target = { source: SOURCE, relativePath: 'a.nes' };
      assert.equal(
        store.metadata.bulkAssignSystem({ scope: 'selected', targets: [target, target] }, 'Game Boy'),
        1
      );
      const metadata = store.roms
        .queryLibrary(query())
        .items.find((entry) => entry.relativePath === 'a.nes')?.metadata;
      assert.equal(metadata?.description, 'Keep this');
      assert.equal(metadata?.systemOverride, 'Game Boy');
      assert.equal(store.metadata.bulkAssignSystem({ scope: 'selected', targets: [target] }, null), 1);
      assert.equal(store.roms.queryLibrary(query({ system: 'NES' })).total, 2);
      store.launchBox.beginLaunchBoxImport();
      store.launchBox.addLaunchBoxGame({ ...GAME, id: 2, title: 'Cancelled' });
      store.launchBox.abortLaunchBoxImport();
      assert.equal(store.launchBox.getLaunchBoxGame(2), null);
      assert.equal(store.launchBox.getLaunchBoxGame(1)?.title, 'Example');
      store.collections.removeCollection(SOURCE);
      assert.equal(store.roms.queryLibrary(query()).total, 0);
      assert.equal(store.metadata.getArtworkId(SOURCE, 'a.nes'), null);
      assert.equal(
        store.identification.cachedFingerprint(SOURCE, 'a.nes', HASHES.size, HASHES.modifiedMs),
        null
      );
      assert.equal(store.identification.matchFingerprint(HASHES).title, 'Matched');
    });
    assertCanonical(file);
  }));
