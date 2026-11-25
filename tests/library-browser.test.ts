import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteLibraryStore, type DatabaseHandle, type Statement } from '../src/main/database/library-store';
import type { LibraryQuery, ScanResult } from '../src/shared';

function adapter(filename: string): DatabaseHandle {
  const db = new DatabaseSync(filename);
  return {
    pragma: sql => db.exec(`PRAGMA ${sql}`), exec: sql => db.exec(sql),
    prepare: sql => db.prepare(sql) as Statement,
    transaction: fn => () => {
      db.exec('BEGIN IMMEDIATE');
      try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (err) { db.exec('ROLLBACK'); throw err; }
    }, close: () => db.close()
  };
}
function scan(source: string, items: Array<[string, string, number]>): ScanResult {
  return { source, scannedAt: new Date().toISOString(), ignored: 0, warnings: [],
    games: items.map(([name, system, bytes]) => ({ id: `${source}-${name}`, name, system,
      relativePath: `${name}.rom`, extension: '.rom', bytes })) };
}
function query(overrides: Partial<LibraryQuery> = {}): LibraryQuery {
  return { source: null, search: '', system: null, sort: 'name', descending: false,
    offset: 0, limit: 2, ...overrides };
}
function withStore(callback: (store: SqliteLibraryStore, file: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-browser-'));
  const file = path.join(root, 'library.sqlite');
  try {
    const store = new SqliteLibraryStore(file, adapter);
    try { callback(store, file); } finally { store.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('initial schema persists existing games when reopened', () => withStore((store, file) => {
  store.saveScan(scan('C:/roms', [['Zelda', 'NES', 3]]));
  assert.equal(store.listCollections()[0].label, 'roms');
  assert.equal(store.queryLibrary(query()).total, 1);
  // Opening an existing version-1 database is safe too.
  const reopened = new SqliteLibraryStore(file, adapter);
  assert.equal(reopened.listCollections().length, 1);
  reopened.close();
}));

test('pagination across collections is stable and sorting works', () => withStore(store => {
  store.saveScan(scan('A:/roms', [['Zelda', 'NES', 12], ['Mario', 'NES', 8]]));
  store.saveScan(scan('B:/roms', [['Sonic', 'Mega Drive', 11], ['Mario', 'NES', 13]]));
  assert.deepEqual(store.queryLibrary(query()).items.map(r => r.name), ['Mario', 'Mario']);
  assert.deepEqual(store.queryLibrary(query({ offset: 2 })).items.map(r => r.name), ['Sonic', 'Zelda']);
  assert.deepEqual(store.queryLibrary(query({ sort: 'bytes', descending: true })).items.map(r => r.bytes), [13, 12]);
  assert.equal(store.queryLibrary(query({ source: 'A:/roms' })).total, 2);
  assert.equal(store.listSystems(null).find(x => x.system === 'NES')?.count, 3);
}));

test('search escapes SQL LIKE wildcards and supports platform filtering', () => withStore(store => {
  store.saveScan(scan('A:/roms', [['Game_1', 'NES', 1], ['Game-1', 'NES', 1], ['Game%2', 'SNES', 1]]));
  assert.equal(store.queryLibrary(query({ search: '_' })).total, 1);
  assert.equal(store.queryLibrary(query({ search: '%' })).total, 1);
  assert.equal(store.queryLibrary(query({ system: 'NES' })).total, 2);
  assert.throws(() => store.queryLibrary(query({ limit: 999 })), /Invalid library page/);
}));

test('rename survives rescans; remove forgets only selected source', () => withStore(store => {
  store.saveScan(scan('A:/roms', [['Mario', 'NES', 1]]));
  store.saveScan(scan('B:/roms', [['Sonic', 'Mega Drive', 1]]));
  store.renameCollection('A:/roms', 'My Classics');
  store.saveScan(scan('A:/roms', [['Zelda', 'NES', 2]]));
  assert.equal(store.listCollections().find(c => c.rootPath === 'A:/roms')?.label, 'My Classics');
  store.removeCollection('A:/roms');
  assert.equal(store.queryLibrary(query()).total, 1);
  assert.equal(store.listCollections()[0].rootPath, 'B:/roms');
  assert.throws(() => store.renameCollection('missing', 'Name'), /not found/);
}));
