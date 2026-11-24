import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteLibraryStore, type DatabaseHandle, type Statement } from '../src/main/database/library-store';
import { artworkPath, cacheArtworkBytes, getArtwork, isArtworkId } from '../src/main/metadata/artwork';
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

test('artwork cache accepts verified images and preserves them for later reuse', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-artwork-'));
  try {
    const id = await cacheArtworkBytes(Buffer.from([0xff,0xd8,0xff,0x00,0x01]),root);
    assert.match(id, /^[a-f0-9]{64}\.jpg$/);
    assert.equal((await getArtwork(root,id)).mime,'image/jpeg');
    await assert.rejects(cacheArtworkBytes(Buffer.from('bad'),root), /supported image/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('v5 to v6 retires unsupported provider references without losing metadata or artwork', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-provider-migration-'));
  const file = path.join(dir,'library.sqlite');
  try {
    const initial = new SqliteLibraryStore(file,adapter);
    initial.saveScan(scan(['old','launch']));
    initial.saveMetadata(source,'old.nes',{...input,artworkId:`${'a'.repeat(64)}.png`,systemOverride:'Super Nintendo'});
    initial.saveMetadata(source,'launch.nes',{...input,provider:'launchbox',providerId:'42'});
    initial.close();
    const old = new DatabaseSync(file);
    old.exec(`UPDATE rom_metadata SET provider='retired-provider', provider_id='123', provider_slug='old-link' WHERE relative_path='old.nes';
      UPDATE schema_version SET version=5;`);
    old.close();
    const migrated = new SqliteLibraryStore(file,adapter);
    const oldGame = migrated.queryLibrary(query).items.find(x => x.relativePath==='old.nes');
    assert.equal(oldGame?.metadata?.provider,'manual');
    assert.equal(oldGame?.metadata?.providerId,null);
    assert.equal(oldGame?.metadata?.providerSlug,null);
    assert.equal(oldGame?.metadata?.title,input.title);
    assert.equal(oldGame?.metadata?.systemOverride,'Super Nintendo');
    assert.equal(oldGame?.metadata?.artworkId,`${'a'.repeat(64)}.png`);
    assert.equal(migrated.queryLibrary(query).items.find(x => x.relativePath==='launch.nes')?.metadata?.provider,'launchbox');
    assert.throws(() => migrated.saveMetadata(source,'old.nes',{...input,provider:'retired-provider' as 'manual'}),/Invalid/);
    migrated.close();
    const raw = new DatabaseSync(file);
    assert.equal((raw.prepare('SELECT version FROM schema_version').get() as {version:number}).version,6);
    raw.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
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
    store.saveMetadata(source, 'one.nes', { ...input, title: 'Online updated', provider: 'launchbox' });
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

test('bulk system edits affect selected ROMs only and preserve saved metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-bulk-'));
  try {
    const store = new SqliteLibraryStore(path.join(dir, 'library.sqlite'), adapter);
    store.saveScan(scan(['one', 'two', 'three']));
    store.saveMetadata(source, 'one.nes', { ...input, title: 'Hand curated', artworkId: `${'a'.repeat(64)}.png` });
    assert.equal(store.bulkAssignSystem({ scope: 'selected', targets: [
      {source, relativePath:'one.nes'}, {source, relativePath:'two.nes'}, {source, relativePath:'one.nes'}
    ] }, 'Super Nintendo'), 2);
    const rows = store.queryLibrary(query).items;
    assert.equal(rows.find(r => r.name === 'one')?.system, 'Super Nintendo');
    assert.equal(rows.find(r => r.name === 'two')?.system, 'Super Nintendo');
    assert.equal(rows.find(r => r.name === 'three')?.system, 'NES');
    assert.equal(rows.find(r => r.name === 'one')?.metadata?.title, 'Hand curated');
    assert.equal(rows.find(r => r.name === 'one')?.metadata?.artworkId, `${'a'.repeat(64)}.png`);
    assert.throws(() => store.bulkAssignSystem({scope:'selected',targets:[{source,relativePath:'missing.nes'}]},'NES'), /no longer exists/);
    store.saveScan(scan(['one','two','three']));
    assert.equal(store.queryLibrary(query).items.find(r => r.name === 'two')?.system, 'Super Nintendo');
    store.close();
    const reopened = new SqliteLibraryStore(path.join(dir, 'library.sqlite'), adapter);
    assert.equal(reopened.queryLibrary(query).items.find(r => r.name === 'two')?.system, 'Super Nintendo');
    assert.equal(reopened.bulkAssignSystem({scope:'selected',targets:[{source,relativePath:'one.nes'},{source,relativePath:'two.nes'}]},null),2);
    assert.equal(reopened.queryLibrary({ ...query, system:'Super Nintendo' }).total,0);
    assert.equal(reopened.queryLibrary(query).items.find(r => r.name === 'one')?.metadata?.title,'Hand curated');
    reopened.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('bulk select-all matches filtered result across pages and respects identification and system filters', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-bulk-all-'));
  try {
    const store = new SqliteLibraryStore(path.join(dir, 'library.sqlite'), adapter);
    store.saveScan(scan(Array.from({length: 235},(_,i) => `Game-${String(i).padStart(3,'0')}`)));
    const selected = store.bulkAssignSystem({scope:'filtered',filter:{source,search:'Game-',system:'NES',identification:'pending'}},'Game Boy');
    assert.equal(selected,235);
    assert.equal(store.queryLibrary({ ...query,system:'Game Boy',limit:10 }).total,235);
    assert.equal(store.bulkAssignSystem({scope:'filtered',filter:{source,search:'Game-00',system:'Game Boy',identification:'pending'}},'Super Nintendo'),10);
    assert.equal(store.queryLibrary({ ...query,system:'Super Nintendo' }).total,10);
    assert.equal(store.queryLibrary({ ...query,system:'Game Boy' }).total,225);
    assert.equal(store.bulkAssignSystem({scope:'filtered',filter:{source,search:'Game-00',system:'Super Nintendo',identification:'pending'}},null),10);
    assert.equal(store.queryLibrary({ ...query,system:'NES' }).total,10);
    assert.equal(store.bulkAssignSystem({scope:'filtered',filter:{source,search:'definitely-not-present',system:null,identification:null}},'NES'),0);
    assert.throws(() => store.bulkAssignSystem({scope:'filtered',filter:{source,search:'',system:null,identification:null}},'\nInvalid'),/Invalid/);
    store.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

// A collection-wide assignment must ignore the currently visible page and filters.
test('collection assignment affects only that collection, across pages, and can be cleared', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-collection-system-'));
  try {
    const store = new SqliteLibraryStore(path.join(dir, 'library.sqlite'), adapter);
    store.saveScan(scan(Array.from({length: 215},(_,i) => `C-${String(i).padStart(3,'0')}`)));
    const otherSource = source + '-another';
    store.saveScan({ ...scan(['Other']), source: otherSource });
    store.saveMetadata(source, 'C-000.nes', { ...input, title: 'Keep this title' });
    const selection = { scope: 'filtered' as const, filter: { source, search: '', system: null, identification: null } };
    assert.equal(store.bulkAssignSystem(selection, 'Super Nintendo'), 215);
    assert.equal(store.queryLibrary({...query,source,system:'Super Nintendo',limit:10}).total,215);
    assert.equal(store.queryLibrary({...query,source:otherSource}).items[0].system,'NES');
    assert.equal(store.queryLibrary({...query,source}).items.find(row => row.name === 'C-000')?.metadata?.title,'Keep this title');
    assert.equal(store.bulkAssignSystem(selection, null),215);
    assert.equal(store.queryLibrary({...query,source,system:'NES',limit:10}).total,215);
    store.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});
