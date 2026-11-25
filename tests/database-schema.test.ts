import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SqliteLibraryStore, type DatabaseHandle, type Statement } from '../src/main/database/library-store';
import { SCHEMA_VERSION } from '../src/main/database/schema';
import { PreparedStatements, renderQuery, sql } from '../src/main/database/query-loader';
import type { LibraryQuery, ScanResult } from '../src/shared';

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

function useStore(file: string, run: (store: SqliteLibraryStore) => void): void {
  const store = new SqliteLibraryStore(file, adapter);
  try {
    run(store);
  } finally {
    store.close();
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
  useStore(
    file,
    (store) => {
      store.saveScan(scan);
      store.renameCollection(SOURCE, 'My collection');
      store.importDat({
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
      store.saveIdentification(
        SOURCE,
        [
          {
            source: SOURCE,
            relativePath: 'a.nes',
            status: 'verified',
            title: 'Matched',
            datName: 'DAT',
            fingerprint: HASHES
          }
        ]
      );
      store.saveMetadata(
        SOURCE,
        'a.nes',
        {
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
        }
      );
      store.beginLaunchBoxImport();
      store.addLaunchBoxGame(GAME);
      assert.equal(store.finishLaunchBoxImport(), 1);
    }
  );
}

const TABLES = [
  'collections',
  'dat_entries',
  'dat_sets',
  'launchbox_games',
  'launchbox_staging',
  'rom_files',
  'rom_identifications',
  'rom_metadata',
  'schema_version'
];

function assertCanonical(file: string): void {
  raw(
    file,
    (db) => {
      const versions = db.prepare('SELECT version FROM schema_version').all();
      assert.deepEqual(versions.map((row) => row.version), [SCHEMA_VERSION]);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all();
      assert.deepEqual(tables.map((row) => row.name), TABLES);
      const metadataColumns = db.prepare('PRAGMA table_info(rom_metadata)').all();
      assert.ok(metadataColumns.some((column) => column.name === 'system_override'));
      assert.ok(db.prepare('PRAGMA table_info(collections)').all().some((column) => column.name === 'label'));
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
      assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    }
  );
}

test(
  'fresh database creates the complete current schema without intermediate migrations',
  () => fixture((file) => {
    const statements: string[] = [];
    const store = new SqliteLibraryStore(
      file,
      (filename) => {
        const db = adapter(filename);
        const exec = db.exec.bind(db);
        db.exec = (value) => {
          statements.push(value);
          exec(value);
        };
        return db;
      }
    );
    store.close();
    assert.equal(SCHEMA_VERSION, 6);
    assert.equal(statements.length, 1);
    assert.ok(!statements[0].includes('ALTER TABLE'));
    assertCanonical(file);
  })
);

// Simulate historical layouts by removing features that did not exist yet.
// Seed real data first, then compare the version-appropriate records after reopening.
for (const version of [1, 2, 3, 4, 5, 6]) {
  test(
    `schema ${version} opens as canonical v6 and preserves existing records`,
    () => fixture((file) => {
      populate(file);
      raw(
        file,
        (db) => {
          db.exec('PRAGMA foreign_keys = OFF');
          if (version < 4) {
            db.exec('DROP TABLE rom_metadata');
          } else if (version === 4) {
            db.exec('ALTER TABLE rom_metadata DROP COLUMN system_override');
          }
          if (version < 3) {
            db.exec('DROP TABLE rom_identifications; DROP TABLE dat_entries; DROP TABLE dat_sets');
          }
          if (version === 1) {
            db.exec('ALTER TABLE collections DROP COLUMN label');
          }
          if (version <= 3) {
            db.exec('DROP TABLE launchbox_games; DROP TABLE launchbox_staging');
          }
          if (version === 4 || version === 5) {
            db.exec("UPDATE rom_metadata SET provider = 'obsolete', provider_id = 'old', provider_slug = 'old'");
          }
          db.prepare('UPDATE schema_version SET version = ?').run(version);
        }
      );
      useStore(
        file,
        (store) => {
          assert.equal(store.queryLibrary(query()).total, 2);
          assert.equal(store.listCollections()[0].label, version === 1 ? 'roms' : 'My collection');
          assert.equal(store.matchFingerprint(HASHES).title, version < 3 ? null : 'Matched');
          const game = store.queryLibrary(query()).items.find((entry) => entry.relativePath === 'a.nes');
          assert.equal(game?.identificationStatus, version < 3 ? 'pending' : 'verified');
          assert.equal(game?.metadata?.description, version < 4 ? undefined : 'Keep this');
          if (version >= 4) {
            assert.equal(store.getArtworkId(SOURCE, 'a.nes'), ARTWORK);
            assert.equal(game?.metadata?.provider, version === 6 ? 'launchbox' : 'manual');
            assert.equal(game?.metadata?.providerId, version === 6 ? '1' : null);
            assert.equal(game?.system, version >= 5 ? 'SNES' : 'NES');
            assert.equal(store.getLaunchBoxGame(1)?.title, GAME.title);
          } else {
            assert.equal(store.getLaunchBoxGame(1), null);
          }
        }
      );
      assertCanonical(file);
      useStore(file, (store) => assert.equal(store.queryLibrary(query()).total, 2));
    })
  );
}

test(
  'existing v6 without lazy LaunchBox tables is completed without losing library data',
  () => fixture((file) => {
    populate(file);
    raw(file, (db) => db.exec('DROP TABLE launchbox_staging; DROP TABLE launchbox_games'));
    useStore(
      file,
      (store) => {
        assert.equal(store.getLaunchBoxGame(1), null);
        assert.equal(store.queryLibrary(query()).total, 2);
        assert.equal(store.getArtworkId(SOURCE, 'a.nes'), ARTWORK);
        store.beginLaunchBoxImport();
        store.addLaunchBoxGame(GAME);
        assert.equal(store.finishLaunchBoxImport(), 1);
        assert.equal(store.searchLaunchBox('Example', 'NES')[0].id, 1);
      }
    );
    assertCanonical(file);
  })
);

test(
  'future, duplicate and unversioned databases are rejected without creating schema tables',
  () => fixture((file) => {
    raw(file, (db) => db.exec('CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES (\'keep\')'));
    assert.throws(() => new SqliteLibraryStore(file, adapter), /unversioned, nonempty/);
    raw(
      file,
      (db) => {
        assert.equal(db.prepare('SELECT value FROM unrelated').get()?.value, 'keep');
        db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (99)');
      }
    );
    assert.throws(() => new SqliteLibraryStore(file, adapter), /Unsupported.*99/);
    raw(file, (db) => db.exec('INSERT INTO schema_version VALUES (6)'));
    assert.throws(() => new SqliteLibraryStore(file, adapter), /Invalid.*schema version/);
    raw(
      file,
      (db) => {
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'collections'").get()?.n, 0);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_version').get()?.n, 2);
      }
    );
  })
);

test(
  'failed legacy upgrade rolls back table creation, column changes and version update',
  () => fixture((file) => {
    populate(file);
    raw(
      file,
      (db) => {
        db.exec('DROP TABLE launchbox_games; DROP TABLE launchbox_staging');
        db.exec('ALTER TABLE rom_metadata DROP COLUMN system_override; UPDATE schema_version SET version = 4');
      }
    );
    assert.throws(
      () => new SqliteLibraryStore(
        file,
        (filename) => {
          const db = adapter(filename);
          const prepare = db.prepare.bind(db);
          db.prepare = (text) => {
            if (text === sql('schema.updateVersion')) {
              throw new Error('Simulated version update failure');
            }
            return prepare(text);
          };
          return db;
        }
      ),
      /Simulated version update failure/
    );
    raw(
      file,
      (db) => {
        assert.equal(db.prepare('SELECT version FROM schema_version').get()?.version, 4);
        assert.ok(!db.prepare('PRAGMA table_info(rom_metadata)').all().some((row) => row.name === 'system_override'));
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'launchbox_games'").get()?.n, 0);
        assert.equal(db.prepare('SELECT description FROM rom_metadata').get()?.description, 'Keep this');
      }
    );
  })
);

test(
  'browse and bulk system assignment use identical bound filters',
  () => fixture((file) => {
    populate(file);
    useStore(
      file,
      (store) => {
        const filter = {
          source: SOURCE,
          system: 'SNES',
          search: '_',
          identification: 'verified' as const
        };
        assert.equal(store.queryLibrary(query(filter)).total, 1);
        assert.equal(store.bulkAssignSystem({ scope: 'filtered', filter }, 'Game Boy'), 1);
        assert.equal(store.queryLibrary(query({ system: 'Game Boy', search: '_' })).total, 1);
        assert.equal(store.queryLibrary(query({ identification: 'pending' })).total, 1);
        assert.equal(store.queryLibrary(query({ search: "%' OR 1=1 --" })).total, 0);
        assert.throws(
          () => store.queryLibrary(query({ sort: 'constructor' as LibraryQuery['sort'] })),
          /Invalid sort order/
        );
        assert.equal(store.queryLibrary(query()).total, 2);
        assert.equal(store.listSystems(SOURCE).find((row) => row.system === 'Game Boy')?.count, 1);
        assert.equal(store.getArtworkId(SOURCE, 'a.nes'), ARTWORK);
      }
    );
  })
);

test(
  'prepared statement cache reuses static statements and rejects incomplete templates',
  () => fixture((file) => {
    useStore(file, () => undefined);
    const db = adapter(file);
    try {
      const statements = new PreparedStatements(db);
      assert.equal(statements.get('collections.lastScan'), statements.get('collections.lastScan'));
      assert.throws(() => statements.get('library.pageGames'), /requires explicit fragments/);
      assert.throws(() => renderQuery('library.pageGames', { where: '' }), /Missing SQL fragment/);
      assert.throws(
        () => renderQuery('library.countGames', { where: '', extra: '' }),
        /Invalid SQL template fragments/
      );
      assert.equal(statements.get('collections.listCollections').all().length, 0);
    } finally {
      db.close();
    }
  })
);

test(
  'metadata edits, fingerprint cache, catalogue cancellation and cascade deletion retain their behavior',
  () => fixture((file) => {
    populate(file);
    useStore(
      file,
      (store) => {
        assert.deepEqual(store.cachedFingerprint(SOURCE, 'a.nes', HASHES.size, HASHES.modifiedMs), HASHES);
        assert.equal(store.cachedFingerprint(SOURCE, 'a.nes', HASHES.size, HASHES.modifiedMs + 1), null);
        assert.equal(store.entriesForIdentification(SOURCE).length, 2);
        const target = { source: SOURCE, relativePath: 'a.nes' };
        assert.equal(store.bulkAssignSystem({ scope: 'selected', targets: [target, target] }, 'Game Boy'), 1);
        const metadata = store.queryLibrary(query()).items.find((entry) => entry.relativePath === 'a.nes')?.metadata;
        assert.equal(metadata?.description, 'Keep this');
        assert.equal(metadata?.systemOverride, 'Game Boy');
        assert.equal(store.bulkAssignSystem({ scope: 'selected', targets: [target] }, null), 1);
        assert.equal(store.queryLibrary(query({ system: 'NES' })).total, 2);
        store.beginLaunchBoxImport();
        store.addLaunchBoxGame({ ...GAME, id: 2, title: 'Cancelled' });
        store.abortLaunchBoxImport();
        assert.equal(store.getLaunchBoxGame(2), null);
        assert.equal(store.getLaunchBoxGame(1)?.title, 'Example');
        store.removeCollection(SOURCE);
        assert.equal(store.queryLibrary(query()).total, 0);
        assert.equal(store.getArtworkId(SOURCE, 'a.nes'), null);
        assert.equal(store.cachedFingerprint(SOURCE, 'a.nes', HASHES.size, HASHES.modifiedMs), null);
        assert.equal(store.matchFingerprint(HASHES).title, 'Matched');
      }
    );
    assertCanonical(file);
  })
);
