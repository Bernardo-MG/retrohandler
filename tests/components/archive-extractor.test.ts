import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { extractArchiveEntry, type ArchiveEntry, type ArchiveReader } from '../../src/main/components/archives';

const entry: ArchiveEntry = { name: 'folder/Metadata.xml', size: 3, directory: false };

function readerFor(chunks: Buffer[]): ArchiveReader {
  return {
    list: async () => [entry],
    open: async (filename, name) => {
      assert.equal(filename, 'archive.zip');
      assert.equal(name, entry.name);
      return Readable.from(chunks);
    }
  };
}

async function temporary(run: (destination: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-archive-extractor-'));
  try {
    await run(path.join(folder, 'output.xml'));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('archive extraction forwards the selected name and reports incremental progress', async () =>
  temporary(async (destination) => {
    const progress: number[] = [];
    await extractArchiveEntry(readerFor([Buffer.from('a'), Buffer.from('bc')]), 'archive.zip', entry, destination, {
      onProgress: (processed, total) => {
        assert.equal(total, entry.size);
        progress.push(processed);
      }
    });
    assert.equal(await readFile(destination, 'utf8'), 'abc');
    assert.deepEqual(progress, [1, 3]);
  }));

test('archive extraction rejects oversized and truncated streams', async () => {
  await temporary(async (destination) => {
    await assert.rejects(
      extractArchiveEntry(readerFor([Buffer.from('abcd')]), 'archive.zip', entry, destination),
      /exceeds declared size/
    );
  });
  await temporary(async (destination) => {
    await assert.rejects(
      extractArchiveEntry(readerFor([Buffer.from('ab')]), 'archive.zip', entry, destination),
      /Truncated archive entry/
    );
  });
});

test('archive extraction rejects directories and cancelled operations before opening a stream', async () =>
  temporary(async (destination) => {
    const reader: ArchiveReader = {
      list: async () => [],
      open: async () => {
        assert.fail('Unexpected stream opening');
      }
    };
    await assert.rejects(
      extractArchiveEntry(reader, 'archive.zip', { ...entry, directory: true }, destination),
      /Cannot extract an archive directory/
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      extractArchiveEntry(reader, 'archive.zip', entry, destination, { signal: controller.signal }),
      { name: 'AbortError' }
    );
  }));

test('archive extraction propagates progress callback failures and cancellation', async () => {
  await temporary(async (destination) => {
    await assert.rejects(
      extractArchiveEntry(readerFor([Buffer.from('abc')]), 'archive.zip', entry, destination, {
        onProgress: () => {
          throw new Error('Progress callback failed.');
        }
      }),
      /Progress callback failed/
    );
  });
  await temporary(async (destination) => {
    const controller = new AbortController();
    await assert.rejects(
      extractArchiveEntry(readerFor([Buffer.from('a'), Buffer.from('bc')]), 'archive.zip', entry, destination, {
        signal: controller.signal,
        onProgress: () => controller.abort()
      }),
      { name: 'AbortError' }
    );
  });
});
