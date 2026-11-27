import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { DatabaseHandle, Statement } from '../../src/main/database/sql/types';
import { openTestRepositories } from '../helpers/database';
import type { LibraryQuery, ScanResult } from '../../src/shared';

// Node 22+ includes a SQLite implementation that can exercise the real SQL,
// without requiring the Electron-specific better-sqlite3 native binary.
let DatabaseSync:
  | (new (file: string) => {
      exec(query: string): void;
      prepare(query: string): unknown;
      close(): void;
    })
  | undefined;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  /* Older Node: skip SQLite integration tests. */
}

function testDatabase(file: string): DatabaseHandle {
  if (!DatabaseSync) throw new Error('node:sqlite is unavailable');
  const db = new DatabaseSync(file);
  return {
    pragma: (sql) => db.exec(`PRAGMA ${sql}`),
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql) as Statement,
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

function result(source: string, names: string[], warnings: ScanResult['warnings'] = []): ScanResult {
  return {
    source,
    scannedAt: new Date().toISOString(),
    ignored: 0,
    warnings,
    games: names.map((name) => ({
      id: name,
      name,
      system: 'Nintendo Entertainment System',
      relativePath: `${name}.nes`,
      extension: '.nes',
      bytes: 123
    }))
  };
}

const query = (source: string): LibraryQuery => ({
  source,
  system: null,
  search: '',
  sort: 'name',
  descending: false,
  offset: 0,
  limit: 20
});

test('SQLite saves and restores a collection across DB reopen', { skip: !DatabaseSync }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-db-'));
  const file = path.join(root, 'app', 'library.sqlite');
  try {
    const first = openTestRepositories(file, testDatabase);
    first.collections.saveScan(result('C:\\roms', ['Game A', 'Game B']));
    first.database.close();
    const second = openTestRepositories(file, testDatabase);
    const restored = second.roms.queryLibrary(query('C:\\roms'));
    assert.deepEqual(
      restored.items.map((game) => game.name),
      ['Game A', 'Game B']
    );
    assert.equal(restored.total, 2);
    assert.equal(second.collections.listCollections()[0].rootPath, 'C:\\roms');
    second.database.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'SQLite rescan updates and removes entries, preserving unseen files after warnings',
  { skip: !DatabaseSync },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-db-'));
    try {
      const store = openTestRepositories(path.join(root, 'library.sqlite'), testDatabase);
      store.collections.saveScan(result('/roms', ['A', 'B']));
      store.collections.saveScan(
        result('/roms', ['A'], [{ relativePath: 'unreadable', message: 'permission denied' }])
      );
      assert.deepEqual(
        store.roms.queryLibrary(query('/roms')).items.map((g) => g.name),
        ['A', 'B']
      );
      store.collections.saveScan(result('/roms', ['A', 'C']));
      assert.deepEqual(
        store.roms.queryLibrary(query('/roms')).items.map((g) => g.name),
        ['A', 'C']
      );
      store.collections.saveScan(result('/roms', ['A', 'C']));
      assert.equal(store.roms.queryLibrary(query('/roms')).total, 2);
      store.database.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
