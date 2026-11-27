import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';
import {
  ArchiveSource,
  createArchiveReader,
  createRestrictedArchiveReader,
  extractArchiveEntry
} from '../../src/main/components/archives';
import { CompositeArchiveReader } from '../../src/main/components/archives/composite-archive-reader';
import { SevenZipArchiveReader } from '../../src/main/components/archives/seven-zip';
import { ZipArchiveReader } from '../../src/main/components/archives/zip';
import { createArchiveFixture } from '../helpers/archive-fixtures';

const data = Buffer.from('123456789');
const crc = 0xcbf43926;
const limits = { maxArchiveBytes: 4096, maxEntryBytes: 1024 };

function archive(method: number, checksum = crc, entryName = 'folder/Metadata.xml'): Buffer {
  const compressed =
    method === 12
      ? Buffer.from(
          '425a6839314159265359fc89191800000008003fe02000220d0c0832621e0def29c177245385090fc8919180',
          'hex'
        )
      : undefined;
  return createArchiveFixture(data, entryName, { method, checksum, compressed });
}

async function fixture(bytes: Buffer, run: (reader: ZipArchiveReader, filename: string) => Promise<void>) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-zip-reader-'));
  try {
    const filename = path.join(folder, 'archive.zip');
    await writeFile(filename, bytes);
    await run(new ZipArchiveReader(limits), filename);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

for (const method of [0, 8]) {
  test(`ZIP reader lists, opens and extracts an exact entry for method ${method}`, async () =>
    fixture(archive(method), async (reader, filename) => {
      assert.equal(await reader.supportsArchive(filename), true);
      const source = await ArchiveSource.resolve(reader, filename);
      const entries = await source.list();
      assert.deepEqual(entries, [
        { name: 'folder/Metadata.xml', size: data.length, directory: false }
      ]);
      await assert.rejects(reader.open(filename, 'Metadata.xml'), /not found/);
      assert.deepEqual(await buffer(await reader.open(filename, 'folder/Metadata.xml')), data);
      const target = path.join(path.dirname(filename), 'output.xml');
      const progress: number[] = [];
      await extractArchiveEntry(source, entries[0], target, {
        onProgress: (processed, total) => {
          assert.equal(total, data.length);
          progress.push(processed);
        }
      });
      assert.deepEqual(await readFile(target), data);
      assert.equal(progress.at(-1), data.length);
      await assert.rejects(extractArchiveEntry(source, entries[0], target), /EEXIST/);
      assert.deepEqual(await readFile(target), data);
    }));
}

test('ZIP reader rejects invalid local headers, mismatched names and incorrect CRCs', async () => {
  const invalidHeader = archive(0);
  invalidHeader.writeUInt32LE(0, 0);
  await fixture(invalidHeader, async (reader, filename) => {
    await assert.rejects(reader.open(filename, 'folder/Metadata.xml'), /Invalid ZIP local header/);
  });
  const mismatchedName = archive(0);
  mismatchedName[30] = 'X'.charCodeAt(0);
  await fixture(mismatchedName, async (reader, filename) => {
    await assert.rejects(reader.open(filename, 'folder/Metadata.xml'), /header mismatch/);
  });
  await fixture(archive(8, 0), async (reader, filename) => {
    await assert.rejects(
      buffer(await reader.open(filename, 'folder/Metadata.xml')),
      /ZIP integrity check failed/
    );
    const source = await ArchiveSource.resolve(reader, filename);
    const [entry] = await source.list();
    await assert.rejects(
      extractArchiveEntry(source, entry, path.join(path.dirname(filename), 'output.xml')),
      /ZIP integrity check failed/
    );
  });
});

test('ZIP reader rejects already cancelled listing and stream requests', async () =>
  fixture(archive(0), async (reader, filename) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(reader.list(filename, controller.signal), { name: 'AbortError' });
    await assert.rejects(reader.open(filename, 'folder/Metadata.xml', controller.signal), { name: 'AbortError' });
  }));

test('ZIP reader applies configured limits before opening entry data', async () =>
  fixture(archive(0), async (_reader, filename) => {
    const archiveLimited = new ZipArchiveReader({ ...limits, maxArchiveBytes: 22 });
    await assert.rejects(archiveLimited.list(filename), /Invalid ZIP size/);
    const entryLimited = new ZipArchiveReader({ ...limits, maxEntryBytes: 1 });
    await assert.rejects(entryLimited.open(filename, 'folder/Metadata.xml'), /Unsupported/);
  }));


test('native ZIP reader advertises ZIP support without claiming other archive formats', () => {
  const reader = new ZipArchiveReader(limits);
  assert.equal(reader.supports('.zip'), true);
  assert.equal(reader.supports('.ZIP'), true);
  assert.equal(reader.supports('.rar'), false);
  assert.equal(reader.supports('.7z'), false);
});

test('classic ZIP archives can be listed and opened without the 7-Zip executable', async () =>
  fixture(archive(8), async (native, filename) => {
    const reader = new CompositeArchiveReader([native, new SevenZipArchiveReader('missing-executable')]);
    const [entry] = await reader.list(filename);
    assert.deepEqual(await buffer(await reader.open(filename, entry.name)), data);
  }));

test('ZIP capability probing declines unsupported compression and filename encodings', async () => {
  await fixture(archive(12), async (reader, filename) => {
    assert.equal(await reader.supportsArchive(filename), false);
  });
  await fixture(archive(0, crc, 'folder/日本語.xml'), async (reader, filename) => {
    assert.equal(await reader.supportsArchive(filename), false);
  });
});

function zip64Archive(): Buffer {
  const bytes = archive(0);
  const footer = Buffer.from(bytes.subarray(-22));
  const classic = bytes.subarray(0, -22);
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(1n, 24);
  record.writeBigUInt64LE(1n, 32);
  record.writeBigUInt64LE(BigInt(footer.readUInt32LE(12)), 40);
  record.writeBigUInt64LE(BigInt(footer.readUInt32LE(16)), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(classic.length), 8);
  locator.writeUInt32LE(1, 16);
  footer.writeUInt16LE(0xffff, 8);
  footer.writeUInt16LE(0xffff, 10);
  footer.writeUInt32LE(0xffffffff, 12);
  footer.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([classic, record, locator, footer]);
}

test('ZIP capability probing recognizes a ZIP64 end record but rejects invalid markers', async () => {
  await fixture(zip64Archive(), async (reader, filename) => {
    assert.equal(await reader.supportsArchive(filename), false);
    await assert.rejects(reader.list(filename), /Unsupported or oversized ZIP directory/);
  });
  const invalid = archive(0);
  invalid.writeUInt32LE(0xffffffff, invalid.length - 22 + 16);
  await fixture(invalid, async (reader, filename) => {
    await assert.rejects(reader.supportsArchive(filename), /Unsupported or oversized ZIP directory/);
  });
  const invalidLocator = zip64Archive();
  invalidLocator.writeBigUInt64LE(0xffffffffffffffffn, invalidLocator.length - 22 - 20 + 8);
  await fixture(invalidLocator, async (reader, filename) => {
    await assert.rejects(reader.supportsArchive(filename), /Unsupported or oversized ZIP directory/);
  });
});

test('ZIP capability probing does not turn malformed directories, limits or cancellation into fallback', async () => {
  await fixture(Buffer.alloc(64), async (reader, filename) => {
    await assert.rejects(reader.supportsArchive(filename), /Invalid ZIP central directory/);
  });
  const invalid = archive(0);
  invalid.writeUInt16LE(0, invalid.length - 22 + 8);
  await fixture(invalid, async (reader, filename) => {
    await assert.rejects(reader.supportsArchive(filename), /Invalid ZIP directory entry count/);
  });
  await fixture(archive(0), async (reader, filename) => {
    const limited = new ZipArchiveReader({ ...limits, maxArchiveBytes: 22 });
    await assert.rejects(limited.supportsArchive(filename), /Invalid ZIP size/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(reader.supportsArchive(filename, controller.signal), { name: 'AbortError' });
  });
});


test('composite ZIP reading selects a compatible backend for unsupported compression', async () =>
  fixture(archive(12), async (native, filename) => {
    const entry = { name: 'folder/Metadata.xml', size: data.length, directory: false };
    const reader = new CompositeArchiveReader([
      native,
      {
        supports: (extension) => extension === '.zip',
        list: async (source) => {
          assert.equal(source, filename);
          return [entry];
        },
        open: async (source, name) => {
          assert.equal(source, filename);
          assert.equal(name, entry.name);
          return Readable.from([data]);
        }
      }
    ]);
    assert.deepEqual(await reader.list(filename), [entry]);
    assert.deepEqual(await buffer(await reader.open(filename, entry.name)), data);
  }));

test('composite ZIP reading does not retry an integrity failure in another backend', async () =>
  fixture(archive(8, 0), async (native, filename) => {
    const reader = new CompositeArchiveReader([native, new SevenZipArchiveReader('missing-executable')]);
    const [entry] = await reader.list(filename);
    await assert.rejects(buffer(await reader.open(filename, entry.name)), /ZIP integrity check failed/);
  }));


test('configured readers handle native archives and preserve the restricted policy', async () => {
  await fixture(archive(8), async (_native, filename) => {
    for (const reader of [createArchiveReader(limits), createRestrictedArchiveReader(limits)]) {
      const [entry] = await reader.list(filename);
      assert.deepEqual(await buffer(await reader.open(filename, entry.name)), data);
    }
  });
  await fixture(archive(12), async (_native, filename) => {
    const reader = createRestrictedArchiveReader(limits);
    const [entry] = await reader.list(filename);
    await assert.rejects(reader.open(filename, entry.name), /Unsupported/);
  });
});
