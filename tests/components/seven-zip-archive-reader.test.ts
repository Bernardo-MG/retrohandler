import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';
import type { ArchiveReader } from '../../src/main/components/archives';
import { SevenZipArchiveReader } from '../../src/main/components/archives/seven-zip';
import { parse7ZipListing } from '../../src/main/components/archives/seven-zip/seven-zip-listing-parser';

test('listing parser rejects malformed headers, invalid sizes and excessive entry counts', () => {
  assert.throws(() => parse7ZipListing('invalid'), /Invalid 7-Zip/);
  assert.throws(() => parse7ZipListing('----------\nPath = a\nSize = -1'), /invalid entry size/);
  const listing = '----------\n' + 'Path = a\nSize = 1\n\n'.repeat(10001);
  assert.throws(() => parse7ZipListing(listing), /Too many archive entries/);
});

test('archive reader rejects already cancelled operations', async () => {
  const reader: ArchiveReader = new SevenZipArchiveReader('unused-executable');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reader.list('test.zip', controller.signal), { name: 'AbortError' });
  await assert.rejects(reader.open('test.zip', 'game.nes', controller.signal), { name: 'AbortError' });
});

test('awaiting an archive stream preserves an early process failure', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-seven-zip-'));
  try {
    const reader = new SevenZipArchiveReader(path.join(folder, 'missing-executable'));
    await assert.rejects(reader.list('test.zip'), /ENOENT/);
    const stream = await reader.open('test.zip', 'game.nes');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assert.rejects(buffer(stream), /ENOENT/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('7-Zip technical listing parses entries and excludes the archive header', () => {
  const result = parse7ZipListing(
    'Path = sample.zip\nType = zip\n----------\nPath = docs\nFolder = +\nSize = 0\n\nPath = Game.nes\nFolder = -\nSize = 14\n'
  );
  assert.deepEqual(result, [
    { name: 'docs', directory: true, size: 0 },
    { name: 'Game.nes', directory: false, size: 14 }
  ]);
});

test('7-Zip listing uses a separator line, not hyphens in an archive name', () => {
  const output = 'Path = sample----------.zip\nType = zip\n----------\nPath = game.nes\nSize = 12\n';
  assert.deepEqual(parse7ZipListing(output), [{ name: 'game.nes', size: 12, directory: false }]);
  assert.throws(() => parse7ZipListing('Path = sample----------.zip\nSize = 12'), /Invalid 7-Zip/);
});

test('7-Zip listing rejects blank, fractional and non-decimal entry sizes', () => {
  for (const size of ['', ' ', '1e2', '0x10', '2.0', '-1', '9007199254740992']) {
    assert.throws(() => parse7ZipListing(`----------\nPath = game.nes\nSize = ${size}\n`), /invalid entry size/);
  }
  assert.equal(parse7ZipListing('----------\nPath = game.nes\nSize = 0\n')[0].size, 0);
});


test('7-Zip reader advertises all supported ROM archive formats', () => {
  const reader = new SevenZipArchiveReader('unused-executable');
  for (const extension of ['.zip', '.ZIP', '.rar', '.7z']) {
    assert.equal(reader.supports(extension), true);
  }
  assert.equal(reader.supports('.nes'), false);
});
