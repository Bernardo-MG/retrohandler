import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readExactly } from '../../src/main/components/filesystem/binary-reader';
import { StreamSizeVerifier } from '../../src/main/components/streams/stream-size-verifier';

const errors = {
  invalidSize: 'Invalid size',
  invalidChunk: 'Invalid chunk',
  oversized: 'Too many bytes',
  truncated: 'Too few bytes'
};

test('binary reader reads at explicit offsets and rejects premature EOF', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-binary-reader-'));
  try {
    const filename = path.join(root, 'data');
    await writeFile(filename, 'abcdef');
    const handle = await open(filename, 'r');
    try {
      assert.deepEqual(await readExactly(handle, 3, 2, 'Truncated'), Buffer.from('cde'));
      assert.deepEqual(await readExactly(handle, 0, 6, 'Truncated'), Buffer.alloc(0));
      await assert.rejects(readExactly(handle, 4, 4, 'Truncated'), /Truncated/);
    } finally {
      await handle.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stream size verifier accepts exact byte counts across multiple chunks', () => {
  const size = new StreamSizeVerifier(3, errors);
  const first = Buffer.from('a');
  assert.equal(size.accept(first), first);
  assert.equal(size.size, 1);
  size.accept(new Uint8Array([2, 3]));
  assert.equal(size.size, 3);
  size.assertComplete();
  new StreamSizeVerifier(0, errors).assertComplete();
});

test('stream size verifier rejects malformed, excessive and incomplete input', () => {
  for (const invalid of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new StreamSizeVerifier(invalid, errors), /Invalid size/);
  }
  const size = new StreamSizeVerifier(2, errors);
  assert.throws(() => size.accept('a'), /Invalid chunk/);
  size.accept(Buffer.from('a'));
  assert.throws(() => size.accept(Buffer.from('bc')), /Too many bytes/);
  assert.equal(size.size, 1);
  assert.throws(() => size.assertComplete(), /Too few bytes/);
  size.accept(Buffer.from('b'));
  size.assertComplete();
});
