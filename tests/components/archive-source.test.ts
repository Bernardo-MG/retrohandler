import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';
import { ArchiveSource, type ArchiveEntry, type ArchiveReader } from '../../src/main/components/archives';

const entry: ArchiveEntry = { name: 'folder/item.bin', size: 3, directory: false };
const content = Buffer.from('abc');

async function fixture(run: (filename: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-archive-source-'));
  try {
    const filename = path.join(folder, 'archive.zip');
    await writeFile(filename, 'archive');
    await run(filename);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function reader(overrides: Partial<ArchiveReader> = {}): ArchiveReader {
  return { list: async () => [entry], open: async () => Readable.from([content]), ...overrides };
}

test('archive source lists and consumes entries from the observed file', async () =>
  fixture(async (filename) => {
    const source = await ArchiveSource.resolve(
      reader({
        list: async (file) => {
          assert.equal(file, filename);
          return [entry];
        },
        open: async (file, name) => {
          assert.equal(file, filename);
          assert.equal(name, entry.name);
          return Readable.from([content]);
        }
      }),
      filename
    );
    assert.deepEqual(await source.list(), [entry]);
    assert.deepEqual(await source.readEntry(entry, buffer), content);
  }));

test('archive source detects a modification during listing', async () =>
  fixture(async (filename) => {
    const source = await ArchiveSource.resolve(
      reader({
        list: async () => {
          await writeFile(filename, 'modified archive');
          return [entry];
        }
      }),
      filename
    );
    await assert.rejects(source.list(), /Archive changed/);
  }));

test('archive source refuses to open entries after the listed file changes', async () =>
  fixture(async (filename) => {
    const source = await ArchiveSource.resolve(
      reader({ open: async () => assert.fail('Unexpected stream opening') }),
      filename
    );
    const [selected] = await source.list();
    await writeFile(filename, 'modified archive');
    await assert.rejects(source.readEntry(selected, buffer), /Archive changed/);
  }));

test('archive source rejects a modification while consuming entry data', async () =>
  fixture(async (filename) => {
    const source = await ArchiveSource.resolve(
      reader({
        open: async () =>
          Readable.from(
            (async function* () {
              yield content;
              await writeFile(filename, 'modified archive');
            })()
          )
      }),
      filename
    );
    await assert.rejects(source.readEntry(entry, buffer), /Archive changed/);
  }));

test('archive source rejects directory, invalid size and pre-cancelled requests', async () =>
  fixture(async (filename) => {
    const source = await ArchiveSource.resolve(
      reader({ open: async () => assert.fail('Unexpected stream opening') }),
      filename
    );
    await assert.rejects(source.readEntry({ ...entry, directory: true }, buffer), /directory/);
    await assert.rejects(source.readEntry({ ...entry, size: -1 }, buffer), /size limit/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(ArchiveSource.resolve(reader(), filename, controller.signal), { name: 'AbortError' });
    await assert.rejects(source.list(controller.signal), { name: 'AbortError' });
    await assert.rejects(source.readEntry(entry, buffer, controller.signal), { name: 'AbortError' });
  }));

test('archive source cancels and destroys an idle entry stream', async () =>
  fixture(async (filename) => {
    const controller = new AbortController();
    const stream = new PassThrough();
    const source = await ArchiveSource.resolve(reader({ open: async () => stream }), filename);
    let entered!: () => void;
    const consuming = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = source.readEntry(
      entry,
      (input) => {
        entered();
        return buffer(input);
      },
      controller.signal
    );
    await consuming;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(stream.destroyed, true);
  }));

test('archive source rejects early stream errors and incomplete consumption', async () =>
  fixture(async (filename) => {
    const failed = new Readable({
      read() {
        this.destroy(new Error('Read failed.'));
      }
    });
    const source = await ArchiveSource.resolve(reader({ open: async () => failed }), filename);
    await assert.rejects(source.readEntry(entry, buffer), /Read failed/);
    const stream = new PassThrough();
    const unread = await ArchiveSource.resolve(reader({ open: async () => stream }), filename);
    await assert.rejects(unread.readEntry(entry, async () => undefined), /not fully consumed/);
    assert.equal(stream.destroyed, true);
  }));

test('archive source rechecks the file after opening and closes a rejected stream', async () =>
  fixture(async (filename) => {
    const stream = new PassThrough();
    const source = await ArchiveSource.resolve(
      reader({
        open: async () => {
          await writeFile(filename, 'modified archive');
          return stream;
        }
      }),
      filename
    );
    await assert.rejects(
      source.readEntry(entry, async () => assert.fail('Unexpected stream consumption')),
      /Archive changed/
    );
    assert.equal(stream.destroyed, true);
  }));

test('archive source does not lose a backend error that occurs before consumption', async () =>
  fixture(async (filename) => {
    const stream = new PassThrough();
    const source = await ArchiveSource.resolve(
      reader({
        open: async () => {
          // Real asynchronous reader implementations also guard errors before handoff.
          stream.on('error', () => undefined);
          stream.destroy(new Error('Early backend failure.'));
          return stream;
        }
      }),
      filename
    );
    await assert.rejects(source.readEntry(entry, buffer), /Early backend failure/);
  }));
