import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import {
  ArchiveFingerprintReader,
  ArchiveSource,
  type ArchiveEntry
} from '../../src/main/components/archives';
import { FingerprintReader } from '../../src/main/components/hashing/fingerprint-reader';

const data = Buffer.from('123456789');
const entry: ArchiveEntry = { name: 'folder/data.bin', size: data.length, directory: false };

async function fixture(run: (source: ArchiveSource) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-archive-fingerprint-'));
  try {
    const filename = path.join(folder, 'archive.zip');
    await writeFile(filename, 'container, not the entry bytes');
    const source = await ArchiveSource.resolve(
      {
        list: async () => [entry],
        open: async (file, name) => {
          assert.equal(file, filename);
          assert.equal(name, entry.name);
          return Readable.from([data.subarray(0, 3), data.subarray(3)]);
        }
      },
      filename
    );
    await run(source);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

const reader = new ArchiveFingerprintReader(new FingerprintReader());

test('archive fingerprint reader hashes the uncompressed entry, not its container', async () =>
  fixture(async (source) => {
    const [selected] = await source.list();
    assert.deepEqual(await reader.read(source, selected), {
      crc32: 'cbf43926',
      md5: createHash('md5').update(data).digest('hex'),
      sha1: createHash('sha1').update(data).digest('hex'),
      size: data.length
    });
  }));

test('archive fingerprint reader rejects content that differs from the declared size', async () =>
  fixture(async (source) => {
    await assert.rejects(reader.read(source, { ...entry, size: entry.size - 1 }), /advertised size/);
    await assert.rejects(reader.read(source, { ...entry, size: entry.size + 1 }), /Truncated stream/);
  }));
