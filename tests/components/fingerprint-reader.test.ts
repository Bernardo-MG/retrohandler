import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { FingerprintReader } from '../../src/main/components/hashing/fingerprint-reader';

const data = Buffer.from('123456789');
const reader = new FingerprintReader();

async function temporary(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-fingerprint-reader-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('direct file reader returns the exact streaming hashes and rejects nonregular inputs', async () =>
  temporary(async (root) => {
    const file = path.join(root, 'game.nes');
    await writeFile(file, data);
    const hashes = await reader.readFile(file);
    assert.equal(hashes.crc32, 'cbf43926');
    assert.equal(hashes.sha1, createHash('sha1').update(data).digest('hex'));
    assert.equal(hashes.md5, createHash('md5').update(data).digest('hex'));
    assert.equal(hashes.size, data.length);
    await assert.rejects(reader.readFile(root), /regular file/);
  }));

test('an idle fingerprint stream is cancelled without waiting for another chunk', async () => {
  const controller = new AbortController();
  const stream = new PassThrough();
  const pending = reader.readStream(stream, 1, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(stream.destroyed, true);
});

test('reader.readStream verifies stream byte count and content fingerprints', async () => {
  const hashes = await reader.readStream(Readable.from([data]), data.length);
  assert.equal(hashes.sha1, createHash('sha1').update(data).digest('hex'));
  assert.equal(hashes.md5, createHash('md5').update(data).digest('hex'));
  await assert.rejects(
    reader.readStream(Readable.from([data]), data.length - 1),
    /advertised size/
  );
  await assert.rejects(reader.readStream(Readable.from([data]), data.length + 1), /Truncated/);
});
