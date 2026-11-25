import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseHandle, Statement } from '../src/main/database/sql/types';
import { openTestRepositories } from './helpers/database';
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

test('metadata survives reopen/rescan, and removal cascades', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-metadata-'));
  const file = path.join(dir, 'library.sqlite');
  try {
    const store = openTestRepositories(file, adapter);
    store.collections.saveScan(scan(['one', 'two']));
    const saved = store.metadata.saveMetadata(source, 'one.nes', input);
    assert.equal(saved.title, input.title);
    assert.equal(store.roms.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.title, 'Example Game');
    store.collections.saveScan(scan(['one', 'two']));
    assert.equal(store.roms.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.description, input.description);
    store.database.close();
    const reopened = openTestRepositories(file, adapter);
    assert.equal(reopened.roms.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.title, 'Example Game');
    assert.throws(() => reopened.metadata.saveMetadata(source, 'not-present.nes', input), /not found/);
    reopened.collections.saveScan(scan(['two']));
    assert.equal(reopened.roms.queryLibrary(query).items[0].metadata, null);
    reopened.collections.removeCollection(source);
    assert.equal(reopened.roms.queryLibrary(query).total, 0);
    reopened.database.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('manual metadata validates bad input and artwork names', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-metadata-'));
  try {
    const store = openTestRepositories(path.join(dir, 'db.sqlite'), adapter);
    store.collections.saveScan(scan(['one']));
    assert.throws(() => store.metadata.saveMetadata(source, 'one.nes', { ...input, title: '' }), /Invalid/);
    assert.throws(() => store.metadata.saveMetadata(source, 'one.nes', { ...input, provider: 'retired-provider' as 'manual' }), /Invalid/);
    assert.throws(() => store.metadata.saveMetadata(source, 'one.nes', { ...input, artworkId: '../../evil.png' }), /Invalid/);
    const id = `${'a'.repeat(64)}.jpg`;
    assert.equal(isArtworkId(id), true);
    assert.equal(isArtworkId('../../evil.jpg'), false);
    assert.equal(artworkPath(dir, id), path.join(dir, id));
    store.database.close();
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

test('metadata and manual system survive rescans and reopen', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-system-'));
  const file = path.join(dir, 'library.sqlite');
  try {
    const initial = openTestRepositories(file, adapter);
    initial.collections.saveScan(scan(['one', 'two']));
    initial.metadata.saveMetadata(source, 'one.nes', input);
    initial.database.close();
    const store = openTestRepositories(file, adapter);
    assert.equal(store.roms.queryLibrary(query).items[0].metadata?.description, input.description);
    store.metadata.saveMetadata(source, 'one.nes', { ...input, systemOverride: 'Super Nintendo' });
    assert.equal(store.roms.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'Super Nintendo');
    assert.equal(store.roms.queryLibrary({ ...query, system: 'Super Nintendo' }).total, 1);
    assert.equal(store.roms.listSystems(source).find(x => x.system === 'Super Nintendo')?.count, 1);
    store.collections.saveScan(scan(['one', 'two']));
    assert.equal(store.roms.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'Super Nintendo');
    // Online metadata imports that omit systemOverride must not erase the manual assignment.
    store.metadata.saveMetadata(source, 'one.nes', { ...input, title: 'Online updated', provider: 'launchbox' });
    assert.equal(store.roms.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'Super Nintendo');
    store.database.close();
    const reopened = openTestRepositories(file, adapter);
    assert.equal(reopened.roms.queryLibrary(query).items.find(x => x.name === 'one')?.metadata?.systemOverride, 'Super Nintendo');
    reopened.metadata.saveMetadata(source, 'one.nes', { ...input, systemOverride: null });
    assert.equal(reopened.roms.queryLibrary(query).items.find(x => x.name === 'one')?.system, 'NES');
    assert.equal(reopened.roms.queryLibrary({ ...query, system: 'Super Nintendo' }).total, 0);
    assert.throws(() => reopened.metadata.saveMetadata(source, 'one.nes', { ...input, systemOverride: '    ' }), /Invalid/);
    reopened.database.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bulk system edits affect selected ROMs only and preserve saved metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-bulk-'));
  try {
    const store = openTestRepositories(path.join(dir, 'library.sqlite'), adapter);
    store.collections.saveScan(scan(['one', 'two', 'three']));
    store.metadata.saveMetadata(source, 'one.nes', { ...input, title: 'Hand curated', artworkId: `${'a'.repeat(64)}.png` });
    assert.equal(store.metadata.bulkAssignSystem({ scope: 'selected', targets: [
      {source, relativePath:'one.nes'}, {source, relativePath:'two.nes'}, {source, relativePath:'one.nes'}
    ] }, 'Super Nintendo'), 2);
    const rows = store.roms.queryLibrary(query).items;
    assert.equal(rows.find(r => r.name === 'one')?.system, 'Super Nintendo');
    assert.equal(rows.find(r => r.name === 'two')?.system, 'Super Nintendo');
    assert.equal(rows.find(r => r.name === 'three')?.system, 'NES');
    assert.equal(rows.find(r => r.name === 'one')?.metadata?.title, 'Hand curated');
    assert.equal(rows.find(r => r.name === 'one')?.metadata?.artworkId, `${'a'.repeat(64)}.png`);
    assert.throws(() => store.metadata.bulkAssignSystem({scope:'selected',targets:[{source,relativePath:'missing.nes'}]},'NES'), /no longer exists/);
    store.collections.saveScan(scan(['one','two','three']));
    assert.equal(store.roms.queryLibrary(query).items.find(r => r.name === 'two')?.system, 'Super Nintendo');
    store.database.close();
    const reopened = openTestRepositories(path.join(dir, 'library.sqlite'), adapter);
    assert.equal(reopened.roms.queryLibrary(query).items.find(r => r.name === 'two')?.system, 'Super Nintendo');
    assert.equal(reopened.metadata.bulkAssignSystem({scope:'selected',targets:[{source,relativePath:'one.nes'},{source,relativePath:'two.nes'}]},null),2);
    assert.equal(reopened.roms.queryLibrary({ ...query, system:'Super Nintendo' }).total,0);
    assert.equal(reopened.roms.queryLibrary(query).items.find(r => r.name === 'one')?.metadata?.title,'Hand curated');
    reopened.database.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('bulk select-all matches filtered result across pages and respects identification and system filters', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-bulk-all-'));
  try {
    const store = openTestRepositories(path.join(dir, 'library.sqlite'), adapter);
    store.collections.saveScan(scan(Array.from({length: 235},(_,i) => `Game-${String(i).padStart(3,'0')}`)));
    const selected = store.metadata.bulkAssignSystem({scope:'filtered',filter:{source,search:'Game-',system:'NES',identification:'pending'}},'Game Boy');
    assert.equal(selected,235);
    assert.equal(store.roms.queryLibrary({ ...query,system:'Game Boy',limit:10 }).total,235);
    assert.equal(store.metadata.bulkAssignSystem({scope:'filtered',filter:{source,search:'Game-00',system:'Game Boy',identification:'pending'}},'Super Nintendo'),10);
    assert.equal(store.roms.queryLibrary({ ...query,system:'Super Nintendo' }).total,10);
    assert.equal(store.roms.queryLibrary({ ...query,system:'Game Boy' }).total,225);
    assert.equal(store.metadata.bulkAssignSystem({scope:'filtered',filter:{source,search:'Game-00',system:'Super Nintendo',identification:'pending'}},null),10);
    assert.equal(store.roms.queryLibrary({ ...query,system:'NES' }).total,10);
    assert.equal(store.metadata.bulkAssignSystem({scope:'filtered',filter:{source,search:'definitely-not-present',system:null,identification:null}},'NES'),0);
    assert.throws(() => store.metadata.bulkAssignSystem({scope:'filtered',filter:{source,search:'',system:null,identification:null}},'\nInvalid'),/Invalid/);
    store.database.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

// A collection-wide assignment must ignore the currently visible page and filters.
test('collection assignment affects only that collection, across pages, and can be cleared', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-collection-system-'));
  try {
    const store = openTestRepositories(path.join(dir, 'library.sqlite'), adapter);
    store.collections.saveScan(scan(Array.from({length: 215},(_,i) => `C-${String(i).padStart(3,'0')}`)));
    const otherSource = source + '-another';
    store.collections.saveScan({ ...scan(['Other']), source: otherSource });
    store.metadata.saveMetadata(source, 'C-000.nes', { ...input, title: 'Keep this title' });
    const selection = { scope: 'filtered' as const, filter: { source, search: '', system: null, identification: null } };
    assert.equal(store.metadata.bulkAssignSystem(selection, 'Super Nintendo'), 215);
    assert.equal(store.roms.queryLibrary({...query,source,system:'Super Nintendo',limit:10}).total,215);
    assert.equal(store.roms.queryLibrary({...query,source:otherSource}).items[0].system,'NES');
    assert.equal(store.roms.queryLibrary({...query,source}).items.find(row => row.name === 'C-000')?.metadata?.title,'Keep this title');
    assert.equal(store.metadata.bulkAssignSystem(selection, null),215);
    assert.equal(store.roms.queryLibrary({...query,source,system:'NES',limit:10}).total,215);
    store.database.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});
