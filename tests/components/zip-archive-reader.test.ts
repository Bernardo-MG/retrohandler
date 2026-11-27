import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { ZipArchiveReader } from '../../src/main/components/archives/zip-archive-reader';

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

async function fixture(bytes: Buffer, run: (reader: ZipArchiveReader, target: string) => Promise<void>) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'rh-zip-reader-'));
  try {
    const filename = path.join(folder, 'archive.zip');
    await writeFile(filename, bytes);
    await run(new ZipArchiveReader(filename, limits), path.join(folder, 'output.xml'));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

for (const method of [0, 8]) {
  test(`ZIP reader extracts and reports progress for method ${method}`, async () =>
    fixture(archive(method), async (reader, target) => {
      const entry = await reader.findEntry('Metadata.xml');
      assert.equal(entry.size, data.length);
      assert.equal(entry.method, method);
      const progress: number[] = [];
      await reader.extract('Metadata.xml', target, {
        onProgress: (processed, total) => {
          assert.equal(total, data.length);
          progress.push(processed);
        }
      });
      assert.deepEqual(await readFile(target), data);
      assert.equal(progress.at(-1), data.length);
      await assert.rejects(reader.extract('Metadata.xml', target), /EEXIST/);
    }));
}

test('ZIP reader rejects invalid local headers and incorrect CRCs', async () => {
  const bytes = archive(0);
  bytes.writeUInt32LE(0, 0);
  await fixture(bytes, async (reader) => {
    await assert.rejects(reader.findEntry('Metadata.xml'), /Invalid ZIP local header/);
  });
  await fixture(archive(8, 0), async (reader, target) => {
    await assert.rejects(reader.extract('Metadata.xml', target), /ZIP integrity check failed/);
  });
});
