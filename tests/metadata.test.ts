import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteLibraryStore, type DatabaseHandle, type Statement } from '../src/main/database/library-store';
import { artworkPath, downloadArtwork, getArtwork, isArtworkId } from '../src/main/metadata/artwork';
import { rawgProvider } from '../src/main/metadata/rawg';
import type { GameMetadataInput, LibraryQuery } from '../src/shared';

function adapter(file: string): DatabaseHandle {
  const db = new DatabaseSync(file);
  return { pragma: sql => db.exec(`PRAGMA ${sql}`), exec: sql => db.exec(sql), prepare: sql => db.prepare(sql) as Statement,
    transaction: fn => () => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } }, close: () => db.close() };
}
const input: GameMetadataInput = { title: 'Example Game', description: 'An example game.', released: '1991-01-01',
  developer: 'Team', publisher: 'Publisher', genre: 'Platformer', provider: 'manual', providerId: null, providerSlug: null, artworkId: null };
const source = '/games';
function scan(names: string[]) { return { source, scannedAt: '2026-11-24T00:00:00Z', ignored: 0, games: names.map(name => ({ id: name, name, system: 'NES', relativePath: name+'.nes', extension: '.nes', bytes: 100 })) }; }
const query: LibraryQuery = { source, search: '', system: null, sort: 'name', descending: false, limit: 10, offset: 0 };

test('schema v3 migrates to v4, metadata survives reopen/rescan, and removal cascades', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-metadata-'));
  const file = path.join(dir, 'library.sqlite');
  try {
    // Simulate existing v3 created by the previous patch.
    const old = new SqliteLibraryStore(file, adapter);
    old.saveScan(scan(['one', 'two'])); old.close();
    const raw = new DatabaseSync(file);
    raw.exec('DROP TABLE rom_metadata; UPDATE schema_version SET version=3;'); raw.close();
    const store = new SqliteLibraryStore(file, adapter);
    const saved = store.saveMetadata(source, 'one.nes', input);
    assert.equal(saved.title, input.title);
    assert.equal(store.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.title, 'Example Game');
    store.saveScan(scan(['one', 'two']));
    assert.equal(store.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.description, input.description);
    store.close();
    const reopened = new SqliteLibraryStore(file, adapter);
    assert.equal(reopened.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.title, 'Example Game');
    assert.throws(() => reopened.saveMetadata(source, 'not-present.nes', input), /not found/);
    reopened.saveScan(scan(['two']));
    assert.equal(reopened.queryLibrary(query).items[0].metadata, null);
    reopened.removeCollection(source);
    assert.equal(reopened.queryLibrary(query).total, 0);
    reopened.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('manual metadata validates bad input and artwork names', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-metadata-'));
  try {
    const store = new SqliteLibraryStore(path.join(dir, 'db.sqlite'), adapter);
    store.saveScan(scan(['one']));
    assert.throws(() => store.saveMetadata(source, 'one.nes', { ...input, title: '' }), /Invalid/);
    assert.throws(() => store.saveMetadata(source, 'one.nes', { ...input, artworkId: '../../evil.png' }), /Invalid/);
    const id = `${'a'.repeat(64)}.jpg`;
    assert.equal(isArtworkId(id), true);
    assert.equal(isArtworkId('../../evil.jpg'), false);
    assert.equal(artworkPath(dir, id), path.join(dir, id));
    store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('RAWG optional provider maps search and detail without live network', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input)); urls.push(url.pathname);
    const payload = url.pathname.endsWith('/42') ? {
      name: 'Sample', slug: 'sample', released: '1991-01-01', description_raw: 'Description',
      developers: [{ name: 'Dev' }], publishers: [{ name: 'Pub' }], genres: [{ name: 'Arcade' }], background_image: null
    } : { results: [{ id: 42, name: 'Sample', released: '1991-01-01', slug: 'sample' }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const candidates = await rawgProvider.search('Sample', 'sample-key-123456');
    assert.equal(candidates[0].id, 42);
    const details = await rawgProvider.detail(42, 'sample-key-123456');
    assert.equal(details.metadata.developer, 'Dev');
    assert.equal(details.metadata.provider, 'rawg');
    assert.deepEqual(urls, ['/api/games', '/api/games/42']);
    await assert.rejects(rawgProvider.search('Sample', 'bad'), /API key/);
  } finally { globalThis.fetch = original; }
});

test('artwork cache accepts bounded image data and rejects untrusted hosts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-artwork-'));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }) as typeof fetch;
  try {
    await assert.rejects(downloadArtwork('https://example.com/cover.jpg', root), /Untrusted/);
    assert.equal(calls, 0);
    const id = await downloadArtwork('https://media.rawg.io/media/example.jpg', root);
    assert.match(id, /^[a-f0-9]{64}\.jpg$/);
    const image = await getArtwork(root, id);
    assert.equal(image.mime, 'image/jpeg');
    assert.equal(image.body.length, 5);
  } finally { globalThis.fetch = original; await rm(root, { recursive: true, force: true }); }
});

test('v4 to v5 migration preserves metadata and manual system across rescans and reopen', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-system-'));
  const file = path.join(dir, 'library.sqlite');
  try {
    const initial = new SqliteLibraryStore(file, adapter);
    initial.saveScan(scan(['one', 'two']));
    initial.saveMetadata(source, 'one.nes', input);
    initial.close();
    // Simulate the old v4 schema with an existing metadata row.
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE rom_metadata_old AS SELECT source_root, relative_path, title, description,
      released, developer, publisher, genre, provider, provider_id, provider_slug, artwork_id FROM rom_metadata;
      DROP TABLE rom_metadata;
      CREATE TABLE rom_metadata (
        source_root TEXT NOT NULL, relative_path TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL, released TEXT NOT NULL,
        developer TEXT NOT NULL, publisher TEXT NOT NULL, genre TEXT NOT NULL,
        provider TEXT NOT NULL, provider_id TEXT, provider_slug TEXT, artwork_id TEXT,
        PRIMARY KEY(source_root, relative_path),
        FOREIGN KEY(source_root, relative_path) REFERENCES rom_files(source_root, relative_path) ON DELETE CASCADE
      );
      INSERT INTO rom_metadata SELECT * FROM rom_metadata_old;
      DROP TABLE rom_metadata_old;
      UPDATE schema_version SET version=4;`);
    old.close();
    const store = new SqliteLibraryStore(file, adapter);
    assert.equal(store.queryLibrary(query).items[0].metadata?.description, input.description);
    store.saveMetadata(source, 'one.nes', { ...input, systemOverride: 'Super Nintendo' });
    assert.equal(store.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'Super Nintendo');
    assert.equal(store.queryLibrary({ ...query, system: 'Super Nintendo' }).total, 1);
    assert.equal(store.listSystems(source).find(x => x.system === 'Super Nintendo')?.count, 1);
    store.saveScan(scan(['one', 'two']));
    assert.equal(store.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'Super Nintendo');
    // Online metadata imports that omit systemOverride must not erase the manual assignment.
    store.saveMetadata(source, 'one.nes', { ...input, title: 'Online updated', provider: 'rawg' });
    assert.equal(store.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'Super Nintendo');
    store.close();
    const reopened = new SqliteLibraryStore(file, adapter);
    assert.equal(reopened.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.systemOverride, 'Super Nintendo');
    reopened.saveMetadata(source, 'one.nes', { ...input, systemOverride: null });
    assert.equal(reopened.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'NES');
    assert.equal(reopened.queryLibrary({ ...query, system: 'Super Nintendo' }).total, 0);
    assert.throws(() => reopened.saveMetadata(source, 'one.nes', { ...input, systemOverride: '    ' }), /Invalid/);
    reopened.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
