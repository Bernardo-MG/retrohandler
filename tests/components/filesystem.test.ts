import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readRegular, statIfExists } from '../../src/main/components/filesystem/file-reader';
import { FileWriter } from '../../src/main/components/filesystem/file-writer';
import {
  assertSafeDirectory,
  childOf,
  ensureSafeDirectory,
  overlaps
} from '../../src/main/components/filesystem/paths';

const writer = new FileWriter('test');

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rh-filesystem-')));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('containment rejects equal paths, siblings and parent traversal', () => {
  const root = path.resolve('root');
  const child = path.join(root, 'child');
  assert.equal(childOf(root, child), true);
  assert.equal(childOf(root, root), false);
  assert.equal(childOf(root, `${root}-other`), false);
  assert.equal(childOf(root, path.resolve(root, '..')), false);
  assert.equal(overlaps(root, root), true);
  assert.equal(overlaps(child, root), true);
  assert.equal(overlaps(root, `${root}-other`), false);
});

test('safe directories allow missing ancestors and reject file ancestors', async () =>
  fixture(async (root) => {
    const nested = path.join(root, 'missing', 'nested');
    await assertSafeDirectory(nested);
    await ensureSafeDirectory(nested);
    assert.ok((await statIfExists(nested))?.isDirectory());
    const file = path.join(root, 'file');
    await writeFile(file, 'data');
    await assert.rejects(assertSafeDirectory(path.join(file, 'child')), /ENOTDIR|not a directory/);
  }));

test('bounded file reads distinguish absent, empty, oversized and nonregular files', async () =>
  fixture(async (root) => {
    const file = path.join(root, 'file');
    assert.equal(await statIfExists(file), null);
    assert.equal(await readRegular(file, 10), null);
    await writeFile(file, '');
    assert.deepEqual(await readRegular(file, 0), Buffer.alloc(0));
    await writeFile(file, 'data');
    assert.deepEqual(await readRegular(file, 4), Buffer.from('data'));
    await assert.rejects(readRegular(file, 3), /Unsafe or oversized/);
    await assert.rejects(readRegular(root, 10), /Unsafe or oversized/);
    await assert.rejects(statIfExists(path.join(file, 'child')), /ENOTDIR/);
  }));

test(
  'linked files and redirected directories are refused',
  { skip: process.platform === 'win32' },
  async () =>
    fixture(async (root) => {
      const file = path.join(root, 'file');
      const link = path.join(root, 'link');
      await writeFile(file, 'original');
      await symlink(file, link);
      await assert.rejects(readRegular(link, 100), /Unsafe or oversized/);
      const directory = path.join(root, 'redirect');
      await symlink(root, directory, 'dir');
      await assert.rejects(ensureSafeDirectory(path.join(directory, 'child')), /redirected/);
    })
);

test('exclusive writes never overwrite or delete existing files', async () =>
  fixture(async (root) => {
    const file = path.join(root, 'file');
    await writer.createExclusive(file, Buffer.from('original'));
    await assert.rejects(writer.createExclusive(file, Buffer.from('replacement')), /EEXIST/);
    assert.equal(await readFile(file, 'utf8'), 'original');
  }));

test('replacement preserves the exact previous bytes in a reported backup', async () =>
  fixture(async (root) => {
    const file = path.join(root, 'file');
    const before = Buffer.from([0, 1, 2, 255]);
    const after = Buffer.from('new');
    await writeFile(file, before);
    const backups: string[] = [];
    await writer.replaceWithBackup({
      targetPath: file,
      newContent: after,
      approvedContent: before,
      maxBytes: 100,
      onBackup: (backup) => backups.push(backup)
    });
    assert.equal(backups.length, 1);
    assert.match(path.basename(backups[0]), /^file\.test-[a-f0-9-]+\.bak$/);
    assert.deepEqual(await readFile(backups[0]), before);
    assert.deepEqual(await readFile(file), after);
    assert.equal((await readdir(root)).filter((name) => name.endsWith('.tmp')).length, 0);
  }));

test('replacement rechecks the destination after backup and reports partial progress', async () =>
  fixture(async (root) => {
    const file = path.join(root, 'file');
    const approved = Buffer.from('old');
    await writeFile(file, 'new'); // Same length but different content.
    const backups: string[] = [];
    await assert.rejects(
      writer.replaceWithBackup({
        targetPath: file,
        newContent: Buffer.from('replacement'),
        approvedContent: approved,
        maxBytes: 100,
        onBackup: (backup) => backups.push(backup)
      }),
      /changed/
    );
    assert.equal(await readFile(file, 'utf8'), 'new');
    assert.equal(backups.length, 1);
    assert.deepEqual(await readFile(backups[0]), approved);
    assert.equal((await readdir(root)).filter((name) => name.endsWith('.tmp')).length, 0);
  }));
