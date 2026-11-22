import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { scanRoms } from '../src/main/scanner';
import { inferPlatform, isCandidateRom } from '../src/main/scanner/platforms';
import { titleFromName } from '../src/main/scanner/naming';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function collection() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-test-'));
  roots.push(root);
  return root;
}

test('platform inference honors folders before extension hints', () => {
  assert.equal(inferPlatform(path.join('snes', 'anything.gb')), 'Super Nintendo');
  assert.equal(inferPlatform('example.gba'), 'Game Boy Advance');
  assert.equal(inferPlatform('example.zip'), 'Needs identification');
  assert.equal(isCandidateRom('game.ZIP'), true);
  assert.equal(isCandidateRom('readme.txt'), false);
});

test('provisional titles remove bracketed tags', () => {
  assert.equal(titleFromName('Super_Mario_(USA)_[!].nes'), 'Super Mario');
});

test('scan returns unchanged public shape, counts ignored files and stable path IDs', async () => {
  const root = await collection();
  await mkdir(path.join(root, 'nes'));
  await writeFile(path.join(root, 'nes', 'Example (USA).nes'), Buffer.from([1, 2, 3]));
  await writeFile(path.join(root, 'nes', 'notes.txt'), 'ignore me');
  const result = await scanRoms(root);
  assert.equal(result.games.length, 1);
  assert.equal(result.ignored, 1);
  assert.equal(result.source, root);
  assert.ok(!Number.isNaN(Date.parse(result.scannedAt)));
  const game = result.games[0];
  const relativePath = path.join('nes', 'Example (USA).nes');
  assert.deepEqual(game, {
    id: createHash('sha256').update(relativePath).digest('hex').slice(0, 16),
    name: 'Example', system: 'Nintendo Entertainment System',
    relativePath, extension: '.nes', bytes: 3
  });
});

test('scanner does not follow symbolic links', async () => {
  const root = await collection();
  const outside = await collection();
  await writeFile(path.join(outside, 'outside.nes'), 'content');
  try {
    await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    // Symlinks require privileges on some Windows configurations.
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
    throw error;
  }
  const result = await scanRoms(root);
  assert.equal(result.games.length, 0);
});

test('scanner reports an invalid path', async () => {
  const root = await collection();
  await assert.rejects(scanRoms(path.join(root, 'missing')));
});


test('progress reports traversal and scan remains backward-compatible', async () => {
  const root = await collection();
  await mkdir(path.join(root, 'snes'));
  await writeFile(path.join(root, 'snes', 'Example.sfc'), 'rom');
  const progress: number[] = [];
  const result = await scanRoms(root, { onProgress: p => progress.push(p.filesVisited) });
  assert.equal(result.games.length, 1);
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1), 1);
  assert.deepEqual(result.warnings, []);
});

test('aborted scans stop before enumerating files', async () => {
  const root = await collection();
  await writeFile(path.join(root, 'Game.nes'), 'rom');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanRoms(root, { signal: controller.signal }), { name: 'AbortError' });
});

test('progress callback can cancel a running scan', async () => {
  const root = await collection();
  await writeFile(path.join(root, 'Game.nes'), 'rom');
  const controller = new AbortController();
  await assert.rejects(scanRoms(root, {
    signal: controller.signal,
    onProgress: () => controller.abort()
  }), { name: 'AbortError' });
});

test('cue sheets consolidate referenced BIN tracks but retain unrelated BIN files', async () => {
  const root = await collection();
  await mkdir(path.join(root, 'psx'));
  await writeFile(path.join(root, 'psx', 'Game.cue'), 'FILE "Game Track 01.bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "Game Track 02.bin" BINARY\n  TRACK 02 AUDIO\n');
  await writeFile(path.join(root, 'psx', 'Game Track 01.bin'), 'track');
  await writeFile(path.join(root, 'psx', 'Game Track 02.bin'), 'track');
  await writeFile(path.join(root, 'psx', 'Standalone.bin'), 'rom');
  const result = await scanRoms(root);
  assert.deepEqual(result.games.map(g => g.extension).sort(), ['.bin', '.cue']);
  assert.equal(result.ignored, 2);
});

test('GDI descriptors consolidate referenced Dreamcast tracks', async () => {
  const root = await collection();
  await mkdir(path.join(root, 'dreamcast'));
  await writeFile(path.join(root, 'dreamcast', 'Game.gdi'), '2\n1 0 4 2352 track01.bin 0\n2 450 4 2352 "track 02.bin" 0\n');
  await writeFile(path.join(root, 'dreamcast', 'track01.bin'), 'track');
  await writeFile(path.join(root, 'dreamcast', 'track 02.bin'), 'track');
  const result = await scanRoms(root);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].extension, '.gdi');
});

test('unreadable descriptor is reported without stopping inventory', async () => {
  const root = await collection();
  await writeFile(path.join(root, 'Bad.cue'), Buffer.alloc(1024 * 1024 + 1));
  await writeFile(path.join(root, 'Good.nes'), 'rom');
  const result = await scanRoms(root);
  assert.equal(result.games.length, 2);
  assert.equal(result.warnings?.length, 1);
  assert.match(result.warnings![0].message, /exceeds 1 MiB/);
});
