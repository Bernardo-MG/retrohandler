import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SevenZipReader, parse7ZipListing } from '../../src/main/components/archives/seven-zip-reader';

test('listing parser rejects malformed headers, invalid sizes and excessive entry counts', () => {
  assert.throws(() => parse7ZipListing('invalid'), /Invalid 7-Zip/);
  assert.throws(() => parse7ZipListing('----------\nPath = a\nSize = -1'), /invalid entry size/);
  const listing = '----------\n' + 'Path = a\nSize = 1\n\n'.repeat(10001);
  assert.throws(() => parse7ZipListing(listing), /Too many archive entries/);
});

test('archive reader rejects already cancelled operations', async () => {
  const reader = new SevenZipReader('unused-executable');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(reader.list('test.zip', controller.signal), { name: 'AbortError' });
  assert.throws(() => reader.open('test.zip', 'game.nes', controller.signal), { name: 'AbortError' });
});
