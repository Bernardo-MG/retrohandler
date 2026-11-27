import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ImageCache, ImageValidationError } from '../../src/main/components/images';
import { createTestImageCache } from '../helpers/image-cache';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
const DAY = 86400000;
const NOW = Date.now();
const asset = (letter: string) => `${letter.repeat(64)}.png`;

async function fixture(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-image-cache-'));
  try {
    await run(await realpath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function agedFile(root: string, name: string, ageDays: number, contents: string): string {
  const file = path.join(root, name);
  writeFileSync(file, contents);
  const date = new Date(NOW - ageDays * DAY);
  utimesSync(file, date, date);
  return file;
}

test('image cache accepts supported signatures and preserves content for reuse', async () =>
  fixture(async (root) => {
    const cache = createTestImageCache(root);
    const id = await cache.store(jpeg);
    assert.match(id, /^[a-f0-9]{64}\.jpg$/);
    assert.equal(cache.pathFor(id), path.join(root, id));
    assert.throws(() => cache.pathFor('../../evil.jpg'), /Invalid image ID/);
    assert.deepEqual(await createTestImageCache(root).read(id), { body: jpeg, mime: 'image/jpeg' });
    assert.deepEqual(await cache.locate(id), { path: path.join(root, id), size: jpeg.length });
    await assert.rejects(cache.store(Buffer.from('bad')), /supported image/);
    await assert.rejects(cache.read(asset('a')), /Invalid cached image/);
  }));

test('image cache verifies content addresses and repairs a replaced image when stored again', async () =>
  fixture(async (root) => {
    const cache = createTestImageCache(root);
    const id = await cache.store(jpeg);
    await writeFile(cache.pathFor(id), Buffer.from([0xff, 0xd8, 0xff, 0x02]));
    // Location metadata alone is not a content validation result.
    assert.equal((await cache.locate(id))?.size, jpeg.length);
    await assert.rejects(cache.read(id), /Invalid cached image/);
    assert.equal(await cache.store(jpeg), id);
    assert.deepEqual((await cache.read(id)).body, jpeg);
    const handle = await open(cache.pathFor(id), 'r+');
    try {
      await handle.truncate(cache.maxImageBytes + 1);
    } finally {
      await handle.close();
    }
    assert.equal(await cache.locate(id), null);
    await assert.rejects(cache.read(id), /Invalid cached image/);
  }));

test('image cache rejects linked files without changing their targets', async (t) =>
  fixture(async (root) => {
    const cache = createTestImageCache(path.join(root, 'cache'));
    const id = await cache.store(jpeg);
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
    assert.equal(await cache.locate(id), null);
    await assert.rejects(cache.read(id), /Invalid cached image/);
    assert.deepEqual(await readFile(external), jpeg);
  }));

test('image cache applies its configured byte limit before creating files', async () =>
  fixture(async (root) => {
    const options = { maxImageBytes: jpeg.length - 1, retentionMs: DAY, temporaryRetentionMs: DAY };
    const cache = new ImageCache(path.join(root, 'missing'), options);
    await assert.rejects(
      cache.store(jpeg),
      (error: unknown) => error instanceof ImageValidationError && error.reason === 'too-large'
    );
    assert.equal(existsSync(cache.root), false);
    assert.throws(() => new ImageCache(root, { ...options, retentionMs: -1 }), /Invalid image cache options/);
  }));

test('cache accounting and cleanup retain referenced images, new images and unrelated files', async () =>
  fixture((root) => {
    const cache = createTestImageCache(root);
    const referenced = agedFile(root, asset('a'), 10, 'keep');
    const unused = agedFile(root, asset('b'), 8, 'delete');
    const recent = agedFile(root, asset('c'), 2, 'recent');
    const staleDownload = agedFile(root, '.download-12345678-1234-1234-1234-123456789abc', 2, 'partial');
    const freshDownload = agedFile(root, '.download-12345678-1234-1234-1234-123456789def', 0, 'new');
    const unrelated = agedFile(root, 'notes.txt', 100, 'notes');
    const refs = new Set([asset('a')]);
    assert.deepEqual(cache.inspect(refs, NOW), {
      cacheFiles: 5,
      cacheBytes: 26,
      reclaimableFiles: 2,
      reclaimableBytes: 13
    });
    assert.deepEqual(cache.cleanup(refs, NOW), { removedFiles: 2, removedBytes: 13, failedFiles: 0 });
    for (const file of [referenced, recent, freshDownload, unrelated]) {
      assert.ok(existsSync(file));
    }
    for (const file of [unused, staleDownload]) {
      assert.equal(existsSync(file), false);
    }
    assert.equal(cache.inspect(refs, NOW).reclaimableFiles, 0);
  }));

test('cache cleanup re-evaluates references and uses configured retention periods', async () =>
  fixture((root) => {
    const cache = new ImageCache(root, { maxImageBytes: 100, retentionMs: DAY, temporaryRetentionMs: 3 * DAY });
    const file = agedFile(root, asset('d'), 2, 'newly referenced');
    const temp = agedFile(root, '.download-12345678-1234-1234-1234-123456789abc', 2, 'partial');
    assert.equal(cache.inspect(new Set(), NOW).reclaimableFiles, 1);
    assert.equal(cache.cleanup(new Set([asset('d')]), NOW).removedFiles, 0);
    assert.ok(existsSync(file));
    assert.equal(cache.cleanup(new Set(), NOW).removedFiles, 1);
    assert.ok(existsSync(temp));
  }));

test('cache cleanup does not create missing directories or recurse into entries', async () =>
  fixture((root) => {
    const cache = createTestImageCache(path.join(root, 'missing'));
    assert.deepEqual(cache.inspect(new Set(), NOW), {
      cacheFiles: 0,
      cacheBytes: 0,
      reclaimableFiles: 0,
      reclaimableBytes: 0
    });
    assert.equal(cache.cleanup(new Set(), NOW).removedFiles, 0);
    assert.equal(existsSync(cache.root), false);
    mkdirSync(cache.root);
    mkdirSync(path.join(cache.root, asset('a')));
    const nested = agedFile(path.join(cache.root, asset('a')), asset('b'), 100, 'retain');
    assert.equal(cache.cleanup(new Set(), NOW).removedFiles, 0);
    assert.ok(existsSync(nested));
  }));

test('cache maintenance refuses redirected ancestors and skips linked files', async () =>
  fixture((root) => {
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    const file = agedFile(outside, asset('e'), 100, 'retain');
    const link = path.join(root, 'link');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const redirected = createTestImageCache(link);
    assert.throws(() => redirected.cleanup(new Set(), NOW), /redirected/);
    mkdirSync(path.join(outside, 'nested'));
    const nested = agedFile(path.join(outside, 'nested'), asset('f'), 100, 'retain nested');
    const redirectedAncestor = createTestImageCache(path.join(link, 'nested'));
    assert.throws(() => redirectedAncestor.inspect(new Set(), NOW), /redirected/);
    assert.throws(() => redirectedAncestor.cleanup(new Set(), NOW), /redirected/);
    assert.equal(readFileSync(nested, 'utf8'), 'retain nested');
    assert.equal(readFileSync(file, 'utf8'), 'retain');
  }));

test('cache cleanup skips linked image files', { skip: process.platform === 'win32' }, async () =>
  fixture((root) => {
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    const file = agedFile(outside, asset('e'), 100, 'retain');
    const cache = createTestImageCache(path.join(root, 'cache'));
    mkdirSync(cache.root);
    symlinkSync(file, cache.pathFor(asset('e')));
    assert.equal(cache.cleanup(new Set(), NOW).removedFiles, 0);
    assert.equal(readFileSync(file, 'utf8'), 'retain');
  }));
