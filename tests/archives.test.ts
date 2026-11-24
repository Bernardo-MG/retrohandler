import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { parse7ZipListing, selectRomMember, type ArchiveReader, type ArchiveMember } from '../src/main/identification/archives';
import { hashReadable } from '../src/main/identification/hashes';
import { identifyCollection, type IdentificationStore } from '../src/main/identification/identify';
import type { IdentificationResult, LibraryEntry } from '../src/shared';

const data = Buffer.from('synthetic archive ROM');
const member: ArchiveMember = { name: 'Game (USA).nes', size: data.length, directory: false };
function mockArchive(members: ArchiveMember[], stream = data): ArchiveReader {
  return { list: async () => members, open: () => Readable.from([stream]) };
}

test('7-Zip technical listing parses members and excludes archive header', () => {
  const result = parse7ZipListing('Path = sample.zip\nType = zip\n----------\nPath = docs\nFolder = +\nSize = 0\n\nPath = Game.nes\nFolder = -\nSize = 14\n');
  assert.deepEqual(result, [{ name: 'docs', directory: true, size: 0 }, { name: 'Game.nes', directory: false, size: 14 }]);
});

test('single-ROM selection is case-insensitive; multi-ROM and non-ROM archives are not misidentified', () => {
  assert.equal(selectRomMember([{ ...member, name: 'Game.GBA' }])?.name, 'Game.GBA');
  assert.equal(selectRomMember([member, { ...member, name: 'Other.nes' }]), null);
  assert.equal(selectRomMember([{ ...member, name: 'readme.txt' }]), null);
  assert.throws(() => selectRomMember([{ ...member, size: 2 ** 31 }]), /size limit/);
});

test('hashReadable verifies decompressed byte count and content fingerprints', async () => {
  const hashes = await hashReadable(Readable.from([data]), data.length);
  assert.equal(hashes.sha1, createHash('sha1').update(data).digest('hex'));
  assert.equal(hashes.md5, createHash('md5').update(data).digest('hex'));
  await assert.rejects(hashReadable(Readable.from([data]), data.length - 1), /advertised size/);
  await assert.rejects(hashReadable(Readable.from([data]), data.length + 1), /Truncated/);
});

test('ZIP, RAR and 7z use uncompressed ROM hashes for DAT matching', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-archive-test-'));
  try {
    const entries: LibraryEntry[] = [];
    for (const ext of ['.zip', '.rar', '.7z']) {
      await writeFile(path.join(root, `packed${ext}`), 'fake archive bytes');
      entries.push({ id: ext, name: 'packed', system: 'NES', extension: ext, bytes: 18, source: root, relativePath: `packed${ext}` });
    }
    let saved: IdentificationResult[] = [];
    const store: IdentificationStore = {
      entriesForIdentification: () => entries,
      cachedFingerprint: () => null,
      matchFingerprint: h => h.sha1 === createHash('sha1').update(data).digest('hex')
        ? { status: 'verified', title: 'Matched game', datName: 'Test DAT' }
        : { status: 'unknown', title: null, datName: null },
      saveIdentification: (_source, results) => { saved = results; }
    };
    const counts = await identifyCollection(root, store, { archiveReader: mockArchive([member]) });
    assert.equal(counts.verified, 3);
    assert.equal(saved.length, 3);
    assert.ok(saved.every(row => row.fingerprint?.size === data.length));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('archive with multiple candidate ROMs remains unsupported', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-archive-test-'));
  try {
    await writeFile(path.join(root, 'bundle.zip'), 'archive');
    const entry: LibraryEntry = { id: 'archive', source: root, relativePath: 'bundle.zip', name: 'bundle', system: 'NES', extension: '.zip', bytes: 7 };
    let saved: IdentificationResult[] = [];
    const store: IdentificationStore = { entriesForIdentification: () => [entry], cachedFingerprint: () => null,
      matchFingerprint: () => ({ status: 'unknown', title: null, datName: null }),
      saveIdentification: (_source, rows) => { saved = rows; } };
    const counts = await identifyCollection(root, store, { archiveReader: mockArchive([member, { ...member, name: 'Other.nes' }]) });
    assert.equal(counts.unsupported, 1);
    assert.equal(saved[0].fingerprint, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancelling during archived ROM hashing does not commit partial results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-archive-test-'));
  try {
    await writeFile(path.join(root, 'packed.zip'), 'archive');
    const entry: LibraryEntry = { id: 'archive', source: root, relativePath: 'packed.zip', name: 'packed', system: 'NES', extension: '.zip', bytes: 7 };
    const controller = new AbortController();
    let saved = false;
    const store: IdentificationStore = { entriesForIdentification: () => [entry], cachedFingerprint: () => null,
      matchFingerprint: () => ({ status: 'unknown', title: null, datName: null }), saveIdentification: () => { saved = true; } };
    const reader: ArchiveReader = { list: async () => [member], open: () => { controller.abort(); return Readable.from([data]); } };
    await assert.rejects(identifyCollection(root, store, { signal: controller.signal, archiveReader: reader }), { name: 'AbortError' });
    assert.equal(saved, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
