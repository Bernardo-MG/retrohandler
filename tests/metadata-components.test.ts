import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import ts from 'typescript';
import { ArtworkCache } from '../src/main/components/artwork/artwork-cache';
import { Crc32 } from '../src/main/components/hashing/crc32';
import { HttpClient, ResponseBodyError } from '../src/main/components/http/http-client';
import { hashReadable } from '../src/main/identification/hashes';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);

function isOversized(error: unknown): boolean {
  return error instanceof ResponseBodyError && error.reason === 'too-large';
}

test('bounded HTTP reads reject declared and observed oversize content and missing bodies', async () => {
  const client = new HttpClient();
  assert.deepEqual(await client.readBytes(new Response('abc'), 3), Buffer.from('abc'));
  await assert.rejects(client.readBytes(new Response('a', { headers: { 'content-length': '4' } }), 3), isOversized);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(4)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(client.readBytes(new Response(body), 3), isOversized);
  assert.equal(cancelled, true);
  await assert.rejects(client.readBytes(new Response(null), 3), (error: unknown) =>
    error instanceof ResponseBodyError && error.reason === 'missing');
});

test('bounded streaming downloads respect actual limits and exclusive creation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-http-component-'));
  try {
    const client = new HttpClient();
    const file = path.join(root, 'download');
    assert.equal(await client.download(new Response('abc'), file, { maxBytes: 3 }), 3);
    assert.equal(await readFile(file, 'utf8'), 'abc');
    await assert.rejects(client.download(new Response('def'), file, { maxBytes: 3 }), /EEXIST/);
    assert.equal(await readFile(file, 'utf8'), 'abc');
    await assert.rejects(client.download(new Response('long'), path.join(root, 'oversize'), { maxBytes: 3 }), isOversized);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CRC32 is incremental and the ROM hashing workflow uses the same standard result', async () => {
  const checksum = new Crc32();
  checksum.update(Buffer.from('1234'));
  checksum.update(Buffer.from('56789'));
  assert.equal(checksum.hex(), 'cbf43926');
  const hashes = await hashReadable(Readable.from([Buffer.from('1234'), Buffer.from('56789')]), 9);
  assert.equal(hashes.crc32, checksum.hex());
  assert.equal(hashes.size, 9);
});

test('artwork cache rejects linked files and validates byte identity on retrieval', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-artwork-component-'));
  try {
    const cache = new ArtworkCache(path.join(root, 'cache'));
    const id = await cache.store(jpeg);
    assert.equal((await cache.find(id))?.size, jpeg.length);
    await writeFile(cache.pathFor(id), Buffer.from([0xff, 0xd8, 0xff, 0x02]));
    await assert.rejects(cache.read(id), /Invalid cached artwork/);
    await rm(cache.pathFor(id));
    const external = path.join(root, 'external.jpg');
    await writeFile(external, jpeg);
    try {
      await symlink(external, cache.pathFor(id), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Symbolic links are unavailable on this system.');
        return;
      }
      throw error;
    }
    assert.equal(await cache.find(id), null);
    await assert.rejects(cache.read(id), /Invalid cached artwork/);
    assert.deepEqual(await readFile(external), jpeg);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : entry.name.endsWith('.ts') ? [filename] : [];
  });
}

function imports(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map(item => item.fileName);
}

test('metadata components depend on contracts, not Electron, IPC or database implementations', () => {
  const mainRoot = path.resolve(__dirname, '../../src/main');
  const metadataRoot = path.join(mainRoot, 'metadata');
  const files = sourceFiles(metadataRoot);
  assert.ok(files.includes(path.join(metadataRoot, 'metadata-service.ts')));
  assert.ok(files.includes(path.join(metadataRoot, 'libretro', 'libretro-provider.ts')));
  const forbidden = files.flatMap(file => imports(file).filter(reference => {
    if (/^(electron|better-sqlite3|node:sqlite)(\/|$)/.test(reference)) {
      return true;
    }
    if (!reference.startsWith('.')) {
      return false;
    }
    const destination = path.relative(mainRoot, path.resolve(path.dirname(file), reference));
    return /^(ipc|database)([\\/]|$)/.test(destination);
  }).map(reference => `${path.relative(mainRoot, file)}: ${reference}`));
  assert.deepEqual(forbidden, []);
  const serviceImports = imports(path.join(metadataRoot, 'metadata-service.ts'));
  assert.ok(!serviceImports.some(reference => /(?:launchbox|libretro)\//.test(reference)));
});
