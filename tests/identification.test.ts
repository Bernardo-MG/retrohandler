import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteLibraryStore, type DatabaseHandle, type Statement } from '../src/main/database/library-store';
import { parseDat } from '../src/main/identification/dat';
import { hashRom } from '../src/main/identification/hashes';
import { identifyCollection } from '../src/main/identification/identify';
import type { ScanResult } from '../src/shared';

function adapter(filename: string): DatabaseHandle {
  const db = new DatabaseSync(filename);
  return {
    pragma: sql => db.exec(`PRAGMA ${sql}`), exec: sql => db.exec(sql),
    prepare: sql => db.prepare(sql) as Statement,
    transaction: fn => () => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; } },
    close: () => db.close()
  };
}
const romData = Buffer.from('retrohandler synthetic test ROM');
const sha1 = createHash('sha1').update(romData).digest('hex');
const md5 = createHash('md5').update(romData).digest('hex');
function xml(games: string[]) {
  return `<?xml version="1.0"?><datafile><header><name>Test &amp; DAT</name></header>${games.map(game =>
    `<game name="${game}"><rom name="test.nes" size="${romData.length}" sha1="${sha1}" md5="${md5}"/></game>`).join('')}</datafile>`;
}
async function fixture(fn: (source: string, store: SqliteLibraryStore) => Promise<void>) {
  const source = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-identification-'));
  const store = new SqliteLibraryStore(path.join(source, 'library.sqlite'), adapter);
  try {
    await writeFile(path.join(source, 'test.nes'), romData);
    await writeFile(path.join(source, 'packed.zip'), 'placeholder');
    const scan: ScanResult = { source, ignored: 0, scannedAt: new Date().toISOString(), games: [
      { id: 'rom', name: 'test', system: 'NES', relativePath: 'test.nes', extension: '.nes', bytes: romData.length },
      { id: 'zip', name: 'packed', system: 'NES', relativePath: 'packed.zip', extension: '.zip', bytes: 11 }
    ] };
    store.saveScan(scan);
    await fn(source, store);
  } finally { store.close(); await rm(source, { recursive: true, force: true }); }
}

test('Logiqx DAT parser handles XML entities, attributes, and machine records', () => {
  const parsed = parseDat(xml(['A &amp; B']));
  assert.equal(parsed.name, 'Test & DAT');
  assert.equal(parsed.entries[0].game, 'A & B');
  assert.equal(parsed.entries[0].sha1, sha1);
  assert.equal(parseDat(`<datafile><machine name="Arcade"><rom name="rom.bin" size="1" crc="00000001"/></machine></datafile>`).entries.length, 1);
  assert.throws(() => parseDat('<!DOCTYPE datafile><datafile/>'), /DTD/);
  assert.throws(() => parseDat('<datafile><header/></datafile>'), /No supported/);
});

test('hashing computes streaming CRC32, MD5 and SHA1, and supports abort', async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-hash-'));
  try {
    const file = path.join(source, 'game.nes');
    await writeFile(file, romData);
    const hashes = await hashRom(file);
    assert.equal(hashes.sha1, sha1);
    assert.equal(hashes.md5, md5);
    assert.equal(hashes.size, romData.length);
    assert.match(hashes.crc32, /^[0-9a-f]{8}$/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(hashRom(file, controller.signal), { name: 'AbortError' });
  } finally { await rm(source, { recursive: true, force: true }); }
});

test('identification persists verified matching, empty ZIP, and a cache usable on rescan', async () => fixture(async (source, store) => {
  store.importDat(parseDat(xml(['Example Game'])));
  const progress: number[] = [];
  const emptyArchive = { list: async () => [], open: () => Readable.from([]) };
  const results = await identifyCollection(source, store, { onProgress: p => progress.push(p.processed), archiveReader: emptyArchive });
  assert.equal(results.verified, 1);
  assert.equal(results.unsupported, 1);
  assert.deepEqual(progress, [2]);
  const entries = store.queryLibrary({ source, search: '', system: null, sort: 'name', descending: false, offset: 0, limit: 10 }).items;
  assert.equal(entries.find(e => e.relativePath === 'test.nes')?.identificationStatus, 'verified');
  assert.equal(entries.find(e => e.relativePath === 'test.nes')?.identifiedTitle, 'Example Game');
  assert.equal(entries.find(e => e.relativePath === 'packed.zip')?.identificationStatus, 'unsupported');
  assert.equal(store.queryLibrary({ source, search: '', system: null, identification: 'verified', sort: 'name', descending: false, offset: 0, limit: 10 }).total, 1);
  assert.equal(store.queryLibrary({ source, search: '', system: null, identification: 'pending', sort: 'name', descending: false, offset: 0, limit: 10 }).total, 0);
  const hashed = await hashRom(path.join(source, 'test.nes'));
  assert.deepEqual(store.cachedFingerprint(source, 'test.nes', hashed.size, hashed.modifiedMs), hashed);
  assert.equal((await identifyCollection(source, store, { archiveReader: emptyArchive })).verified, 1);
}));

test('conflicting DAT games are ambiguous and cancellation never replaces saved matches', async () => fixture(async (source, store) => {
  store.importDat(parseDat(xml(['One', 'Two'])));
  assert.equal((await identifyCollection(source, store)).ambiguous, 1);
  const controller = new AbortController();
  await assert.rejects(identifyCollection(source, store, { signal: controller.signal, onProgress: () => controller.abort() }), { name: 'AbortError' });
  const entry = store.queryLibrary({ source, search: '', system: null, sort: 'name', descending: false, offset: 0, limit: 10 }).items.find(e => e.relativePath === 'test.nes');
  assert.equal(entry?.identificationStatus, 'ambiguous');
}));

test('reimporting same DAT replaces entries atomically', async () => fixture(async (_source, store) => {
  store.importDat(parseDat(xml(['One'])));
  assert.equal(store.matchFingerprint({ sha1, md5, crc32: '00000000', size: romData.length, modifiedMs: 0 }).title, 'One');
  store.importDat(parseDat(xml(['Two'])));
  assert.equal(store.matchFingerprint({ sha1, md5, crc32: '00000000', size: romData.length, modifiedMs: 0 }).title, 'Two');
}));
