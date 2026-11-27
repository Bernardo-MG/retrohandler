import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { ArchiveReader, ArchiveEntry } from '../../src/main/components/archives';
import { FingerprintReader } from '../../src/main/components/hashing/fingerprint-reader';
import { selectRomEntry } from '../../src/main/identification/rom/archive-rom-selection';
import type { IdentificationRepository } from '../../src/main/contracts/persistence';
import { identificationService } from '../helpers/identification';
import type { IdentificationResult, LibraryEntry } from '../../src/shared';

const data = Buffer.from('synthetic archive ROM');
const fingerprintReader = new FingerprintReader();
const romEntry: ArchiveEntry = { name: 'Game (USA).nes', size: data.length, directory: false };
function mockArchive(entries: ArchiveEntry[], stream = data): ArchiveReader {
  return { list: async () => entries, open: async () => Readable.from([stream]) };
}

test('single-ROM selection is case-insensitive; multi-ROM and non-ROM archives are not misidentified', () => {
  assert.equal(selectRomEntry([{ ...romEntry, name: 'Game.GBA' }])?.name, 'Game.GBA');
  assert.equal(selectRomEntry([romEntry, { ...romEntry, name: 'Other.nes' }]), null);
  assert.equal(selectRomEntry([{ ...romEntry, name: 'readme.txt' }]), null);
  assert.throws(() => selectRomEntry([{ ...romEntry, size: 2 ** 31 }]), /size limit/);
});

test('fingerprintReader.readStream verifies decompressed byte count and content fingerprints', async () => {
  const hashes = await fingerprintReader.readStream(Readable.from([data]), data.length);
  assert.equal(hashes.sha1, createHash('sha1').update(data).digest('hex'));
  assert.equal(hashes.md5, createHash('md5').update(data).digest('hex'));
  await assert.rejects(
    fingerprintReader.readStream(Readable.from([data]), data.length - 1),
    /advertised size/
  );
  await assert.rejects(fingerprintReader.readStream(Readable.from([data]), data.length + 1), /Truncated/);
});

test('ZIP, RAR and 7z use uncompressed ROM hashes for DAT matching', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-archive-test-'));
  try {
    const entries: LibraryEntry[] = [];
    for (const ext of ['.zip', '.rar', '.7z']) {
      await writeFile(path.join(root, `packed${ext}`), 'fake archive bytes');
      entries.push({
        id: ext,
        name: 'packed',
        system: 'NES',
        extension: ext,
        bytes: 18,
        source: root,
        relativePath: `packed${ext}`
      });
    }
    let saved: IdentificationResult[] = [];
    const store: IdentificationRepository = {
      importDat: () => {
        throw new Error('Unexpected DAT import.');
      },
      entriesForIdentification: () => entries,
      cachedFingerprint: () => null,
      matchFingerprint: (h) =>
        h.sha1 === createHash('sha1').update(data).digest('hex')
          ? { status: 'verified', title: 'Matched game', datName: 'Test DAT' }
          : { status: 'unknown', title: null, datName: null },
      saveIdentification: (_source, results) => {
        saved = [...results];
      }
    };
    const counts = await identificationService(store, mockArchive([romEntry])).identifyCollection(root);
    assert.equal(counts.verified, 3);
    assert.equal(saved.length, 3);
    assert.ok(saved.every((row) => row.fingerprint?.size === data.length));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('archive with multiple candidate ROMs remains unsupported', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-archive-test-'));
  try {
    await writeFile(path.join(root, 'bundle.zip'), 'archive');
    const entry: LibraryEntry = {
      id: 'archive',
      source: root,
      relativePath: 'bundle.zip',
      name: 'bundle',
      system: 'NES',
      extension: '.zip',
      bytes: 7
    };
    let saved: IdentificationResult[] = [];
    const store: IdentificationRepository = {
      importDat: () => {
        throw new Error('Unexpected DAT import.');
      },
      entriesForIdentification: () => [entry],
      cachedFingerprint: () => null,
      matchFingerprint: () => ({ status: 'unknown', title: null, datName: null }),
      saveIdentification: (_source, rows) => {
        saved = [...rows];
      }
    };
    const counts = await identificationService(
      store,
      mockArchive([romEntry, { ...romEntry, name: 'Other.nes' }])
    ).identifyCollection(root);
    assert.equal(counts.unsupported, 1);
    assert.equal(saved[0].fingerprint, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelling during archived ROM hashing does not commit partial results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-archive-test-'));
  try {
    await writeFile(path.join(root, 'packed.zip'), 'archive');
    const entry: LibraryEntry = {
      id: 'archive',
      source: root,
      relativePath: 'packed.zip',
      name: 'packed',
      system: 'NES',
      extension: '.zip',
      bytes: 7
    };
    const controller = new AbortController();
    let saved = false;
    const store: IdentificationRepository = {
      importDat: () => {
        throw new Error('Unexpected DAT import.');
      },
      entriesForIdentification: () => [entry],
      cachedFingerprint: () => null,
      matchFingerprint: () => ({ status: 'unknown', title: null, datName: null }),
      saveIdentification: () => {
        saved = true;
      }
    };
    const reader: ArchiveReader = {
      list: async () => [romEntry],
      open: async () => {
        controller.abort();
        return Readable.from([data]);
      }
    };
    await assert.rejects(
      identificationService(store, reader).identifyCollection(root, { signal: controller.signal }),
      { name: 'AbortError' }
    );
    assert.equal(saved, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
