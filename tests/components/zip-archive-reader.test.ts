import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { extractArchiveEntry, ZipArchiveReader, type ArchiveReader } from '../../src/main/components/archives';

const data = Buffer.from('123456789');
const crc = 0xcbf43926;
const limits = { maxArchiveBytes: 4096, maxEntryBytes: 1024 };

function archive(method: number, checksum = crc): Buffer {
  const name = Buffer.from('folder/Metadata.xml');
  const compressed = method === 8 ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(method, 10);
  directory.writeUInt32LE(checksum, 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, directory, name, end]);
}

async function fixture(bytes: Buffer, run: (reader: ArchiveReader, filename: string) => Promise<void>) {
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
      const entries = await reader.list(filename);
      assert.deepEqual(entries, [
        { name: 'folder/Metadata.xml', size: data.length, directory: false }
      ]);
      await assert.rejects(reader.open(filename, 'Metadata.xml'), /not found/);
      assert.deepEqual(await buffer(await reader.open(filename, 'folder/Metadata.xml')), data);
      const target = path.join(path.dirname(filename), 'output.xml');
      const progress: number[] = [];
      await extractArchiveEntry(reader, filename, entries[0], target, {
        onProgress: (processed, total) => {
          assert.equal(total, data.length);
          progress.push(processed);
        }
      });
      assert.deepEqual(await readFile(target), data);
      assert.equal(progress.at(-1), data.length);
      await assert.rejects(extractArchiveEntry(reader, filename, entries[0], target), /EEXIST/);
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
    const [entry] = await reader.list(filename);
    await assert.rejects(
      extractArchiveEntry(reader, filename, entry, path.join(path.dirname(filename), 'output.xml')),
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
