import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import {
  ArchiveSource,
  extractArchiveEntry,
  type ArchiveEntry,
  type ArchiveReader
} from '../../src/main/components/archives';

const entry: ArchiveEntry = { name: 'folder/Metadata.xml', size: 3, directory: false };

async function sourceFor(filename: string, chunks: Buffer[]): Promise<ArchiveSource> {
  return ArchiveSource.resolve(
    {
      list: async () => [entry],
      open: async (source, name) => {
        assert.equal(source, filename);
        assert.equal(name, entry.name);
        return Readable.from(chunks);
      }
    },
    filename
  );
}

async function temporary(run: (destination: string, filename: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-archive-extractor-'));
  try {
    const filename = path.join(folder, 'archive.zip');
    await writeFile(filename, 'archive');
    await run(path.join(folder, 'output.xml'), filename);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test('archive extraction forwards the selected name and reports incremental progress', async () =>
  temporary(async (destination, filename) => {
    const progress: number[] = [];
    const source = await sourceFor(filename, [Buffer.from('a'), Buffer.from('bc')]);
    await extractArchiveEntry(source, entry, destination, {
      onProgress: (processed, total) => {
        assert.equal(total, entry.size);
        progress.push(processed);
      }
    });
    assert.equal(await readFile(destination, 'utf8'), 'abc');
    assert.deepEqual(progress, [1, 3]);
  }));

test('archive extraction rejects oversized and truncated streams', async () => {
  await temporary(async (destination, filename) => {
    const source = await sourceFor(filename, [Buffer.from('abcd')]);
    await assert.rejects(extractArchiveEntry(source, entry, destination), /exceeds declared size/);
  });
  await temporary(async (destination, filename) => {
    const source = await sourceFor(filename, [Buffer.from('ab')]);
    await assert.rejects(extractArchiveEntry(source, entry, destination), /Truncated archive entry/);
  });
});

test('archive extraction rejects directories and cancelled operations before opening a stream', async () =>
  temporary(async (destination, filename) => {
    const reader: ArchiveReader = {
      list: async () => [],
      open: async () => {
        assert.fail('Unexpected stream opening');
      }
    };
    const source = await ArchiveSource.resolve(reader, filename);
    await assert.rejects(
      extractArchiveEntry(source, { ...entry, directory: true }, destination),
      /Cannot extract an archive directory/
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(extractArchiveEntry(source, entry, destination, { signal: controller.signal }), {
      name: 'AbortError'
    });
  }));

test('archive extraction propagates progress callback failures and cancellation', async () => {
  await temporary(async (destination, filename) => {
    const source = await sourceFor(filename, [Buffer.from('abc')]);
    await assert.rejects(
      extractArchiveEntry(source, entry, destination, {
        onProgress: () => {
          throw new Error('Progress callback failed.');
        }
      }),
      /Progress callback failed/
    );
  });
  await temporary(async (destination, filename) => {
    const controller = new AbortController();
    const source = await sourceFor(filename, [Buffer.from('a'), Buffer.from('bc')]);
    await assert.rejects(
      extractArchiveEntry(source, entry, destination, {
        signal: controller.signal,
        onProgress: () => controller.abort()
      }),
      { name: 'AbortError' }
    );
  });
});
