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
