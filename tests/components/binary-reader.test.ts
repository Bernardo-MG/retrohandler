import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readExactly } from '../../src/main/components/filesystem/binary-reader';

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
