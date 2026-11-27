import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ScanResult } from '../../src/shared';
import type { ScanRepository } from '../../src/main/contracts/persistence';
import { FileSystemLibraryService } from '../../src/main/services/library/library-service';

class RecordingStore implements ScanRepository {
  scans: ScanResult[] = [];
  saveScan(result: ScanResult) {
    this.scans.push(result);
  }
  loadLastScan() {
    return this.scans.at(-1) ?? null;
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-persistence-'));
  await writeFile(path.join(root, 'Example.nes'), 'rom-data');
  return root;
}

test('completed scan is persisted and can be loaded', async () => {
  const root = await fixture();
  try {
    const store = new RecordingStore();
    const library = new FileSystemLibraryService({ collections: store });
    assert.equal(await library.loadLastScan(), null);
    const result = await library.scanFolder(root);
    assert.equal(result.games.length, 1);
    assert.deepEqual(await library.loadLastScan(), result);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation does not replace a saved collection', async () => {
  const root = await fixture();
  try {
    const store = new RecordingStore();
    const library = new FileSystemLibraryService({ collections: store });
    const previous = await library.scanFolder(root);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(library.scanFolder(root, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(store.scans.length, 1);
    assert.deepEqual(await library.loadLastScan(), previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid scan path does not overwrite persisted library', async () => {
  const root = await fixture();
  try {
    const store = new RecordingStore();
    const library = new FileSystemLibraryService({ collections: store });
    const previous = await library.scanFolder(root);
    await assert.rejects(library.scanFolder(path.join(root, 'missing')));
    assert.equal(store.scans.length, 1);
    assert.deepEqual(await library.loadLastScan(), previous);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('without a store scans remain backward-compatible', async () => {
  const root = await fixture();
  try {
    const library = new FileSystemLibraryService();
    assert.equal((await library.scanFolder(root)).games.length, 1);
    assert.equal(await library.loadLastScan(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('library service does not persist a scan cancelled by an injected scanner', async () => {
  const store = new RecordingStore();
  const controller = new AbortController();
  const scanner = {
    async scan(): Promise<ScanResult> {
      controller.abort();
      return { source: '/games', games: [], ignored: 0, scannedAt: new Date().toISOString() };
    }
  };
  const library = new FileSystemLibraryService({ collections: store }, scanner);
  await assert.rejects(library.scanFolder('/games', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(store.scans.length, 0);
});
