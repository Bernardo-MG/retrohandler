import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { QueryExecutor } from '../src/main/database/sql/query-executor';
import { QueryRegistry } from '../src/main/database/sql/query-registry';
import { DatabaseConnection } from '../src/main/database/database-connection';
import { createCollectionRepository, createRomRepository, createMetadataRepository, createIdentificationRepository, createLaunchBoxRepository } from '../src/main/database';
import type { DatabaseHandle, Statement } from '../src/main/database/sql/types';
import type { GameMetadataInput, LibraryQuery, ScanResult } from '../src/shared';

function adapt(db: DatabaseSync, onPrepare: (sql: string) => void = () => {}): DatabaseHandle {
  return {
    pragma: sql => db.exec(`PRAGMA ${sql}`),
    exec: sql => db.exec(sql),
    prepare: sql => {
      onPrepare(sql);
      return db.prepare(sql) as Statement;
    },
    transaction: operation => () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = operation();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close()
  };
}

function executorFixture(run: (executor: QueryExecutor, prepared: string[]) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-executor-'));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const catalog = path.join(root, 'example.sql');
    writeFileSync(catalog, [
      '-- name: insert', 'INSERT INTO records(id, value) VALUES (?, ?);',
      '-- name: find', 'SELECT value FROM records WHERE id = ?;',
      '-- name: all', 'SELECT value FROM records ORDER BY id;',
      '-- name: clear', 'DELETE FROM records;',
      '-- name: template', 'SELECT {{column}} FROM records;'
    ].join('\n'));
    const registry = new QueryRegistry();
    registry.load('example', catalog);
    const prepared: string[] = [];
    run(new QueryExecutor(adapt(db, sql => prepared.push(sql)), registry), prepared);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test('generic executor reads, writes, binds parameters and caches named statements', () => executorFixture((executor, prepared) => {
  const value = "' OR 1=1 --";
  assert.equal(executor.findOne('example.find', 1), null);
  assert.throws(() => executor.findRequired('example.find', 1), /Expected a database record/);
  assert.equal(executor.execute('example.insert', 1, value), 1);
  assert.equal(executor.execute('example.insert', 2, 'other'), 1);
  assert.equal(executor.findRequired<{ value: string }>('example.find', 1).value, value);
  assert.deepEqual(executor.findAll<{ value: string }>('example.all').map(row => row.value), [value, 'other']);
  assert.equal(prepared.filter(sql => sql.includes('WHERE id')).length, 1);
  assert.equal(prepared.filter(sql => sql.startsWith('INSERT')).length, 1);
  assert.throws(() => executor.findAll('example.template'), /requires explicit fragments/);
  assert.throws(() => executor.findAll('example.missing'), /Unknown SQL statement/);
}));

test('dynamic SQL is parameterized and is not added to the prepared statement cache', () => executorFixture((executor, prepared) => {
  executor.execute('example.insert', 1, 'one');
  const query = { sql: 'SELECT value FROM records WHERE id = ?' };
  assert.equal(executor.findOne<{ value: string }>(query, 1)?.value, 'one');
  assert.equal(executor.findOne(query, 2), null);
  assert.equal(prepared.filter(sql => sql === query.sql).length, 2);
}));

test('executor returns transaction results and rolls back batch and single statement writes', () => executorFixture((executor) => {
  assert.equal(executor.transaction(() => executor.execute('example.insert', 1, 'kept')), 1);
  assert.throws(() => executor.transaction(() => {
    executor.executeBatch('example.clear');
    executor.execute('example.insert', 2, 'not kept');
    throw new Error('abort');
  }), /abort/);
  assert.deepEqual(executor.findAll<{ value: string }>('example.all').map(row => row.value), ['kept']);
  assert.throws(() => executor.executeBatch('example.template'), /requires explicit fragments/);
}));

test('domain repositories share committed data and artwork references reflect removals immediately', () => {
  const database = DatabaseConnection.open(':memory:', () => adapt(new DatabaseSync(':memory:')));
  try {
    const collections = createCollectionRepository(database);
    const roms = createRomRepository(database);
    const metadataRepository = createMetadataRepository(database);
    const identification = createIdentificationRepository(database);
    const source = '/roms';
    const scan: ScanResult = {
      source, scannedAt: '2026-11-25T00:00:00Z', ignored: 0,
      games: ['one', 'two'].map(name => ({ id: name, name, system: 'NES', relativePath: `${name}.nes`, extension: '.nes', bytes: 1 }))
    };
    const query: LibraryQuery = { source, search: '', system: null, sort: 'name', descending: false, offset: 0, limit: 10 };
    const artworkId = `${'a'.repeat(64)}.png`;
    const metadata: GameMetadataInput = {
      title: 'Curated game', description: 'Description', released: '', developer: '', publisher: '', genre: '',
      provider: 'manual', providerId: null, providerSlug: null, artworkId
    };
    collections.saveScan(scan);
    assert.equal(collections.listCollections()[0].gameCount, 2);
    assert.equal(roms.queryLibrary(query).total, 2);
    assert.equal(identification.entriesForIdentification(source).length, 2);
    assert.equal(metadataRepository.getArtworkId(source, 'one.nes'), null);
    assert.deepEqual(metadataRepository.getReferencedArtworkIds(), new Set());
    metadataRepository.saveMetadata(source, 'one.nes', metadata);
    metadataRepository.saveMetadata(source, 'two.nes', metadata);
    assert.equal(metadataRepository.getArtworkId(source, 'one.nes'), artworkId);
    assert.deepEqual(metadataRepository.getReferencedArtworkIds(), new Set([artworkId]));
    metadataRepository.bulkAssignSystem({ scope: 'filtered', filter: query }, 'SNES');
    assert.equal(roms.queryLibrary({ ...query, system: 'SNES' }).total, 2);
    collections.removeCollection(source);
    assert.deepEqual(metadataRepository.getReferencedArtworkIds(), new Set());
    assert.equal(roms.queryLibrary(query).total, 0);
  } finally {
    database.close();
  }
});

test('LaunchBox repository stages, publishes and aborts catalogue updates independently', () => {
  const database = DatabaseConnection.open(':memory:', () => adapt(new DatabaseSync(':memory:')));
  try {
    const catalogue = createLaunchBoxRepository(database);
    const game = { id: 1, title: 'Original', platform: 'NES', released: '', description: '', developer: '', publisher: '', genre: '' };
    catalogue.beginLaunchBoxImport();
    catalogue.addLaunchBoxGame(game);
    assert.equal(catalogue.getLaunchBoxGame(1), null);
    assert.equal(catalogue.finishLaunchBoxImport(), 1);
    assert.equal(catalogue.getLaunchBoxGame(1)?.title, 'Original');
    catalogue.beginLaunchBoxImport();
    catalogue.addLaunchBoxGame({ ...game, id: 2, title: 'Replacement' });
    catalogue.abortLaunchBoxImport();
    assert.equal(catalogue.getLaunchBoxGame(2), null);
    assert.equal(catalogue.searchLaunchBox('Original', 'NES')[0].id, 1);
  } finally {
    database.close();
  }
});
