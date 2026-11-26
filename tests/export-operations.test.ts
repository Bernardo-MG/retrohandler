import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FileDestination } from '../src/main/components/file-operations/file-destination';
import { FileOperationExecutor } from '../src/main/components/file-operations/file-operation-executor';
import { FileOperationPlanner } from '../src/main/components/file-operations/file-operation-planner';
import { FileWriter } from '../src/main/components/filesystem/file-writer';

async function fixture(run: (root: string, destination: string, planner: FileOperationPlanner, executor: FileOperationExecutor) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rh-export-operations-')));
  const destination = path.join(root, 'destination');
  try {
    const scope = new FileDestination(destination);
    await run(root, destination, new FileOperationPlanner(scope), new FileOperationExecutor(scope, new FileWriter('retrohandler')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('generic copy and generated operations create and reuse files without format-specific kinds', async () => fixture(async (root, destination, planner, executor) => {
  const source = path.join(root, 'source.bin');
  await writeFile(source, 'data');
  const copy = await planner.planCopy('assets/a.bin', source, 4, 100, 'asset');
  const generated = await planner.planGenerated('index.json', 100, previous => {
    assert.equal(previous, null);
    return Buffer.from('{}');
  });
  assert.deepEqual(copy.content, { file: source });
  assert.equal(copy.action, 'create');
  assert.equal(generated.action, 'create');
  await assert.rejects(readdir(destination));
  assert.deepEqual(await executor.execute([copy, generated]), { copied: 2 });
  assert.equal(await readFile(path.join(destination, 'assets/a.bin'), 'utf8'), 'data');
  const again = await planner.planCopy('assets/a.bin', source, 4, 100, 'asset');
  const same = await planner.planGenerated('index.json', 100, previous => previous!);
  assert.equal(again.action, 'reuse');
  assert.equal(same.action, 'reuse');
  assert.deepEqual(await executor.execute([again, same]), { copied: 0 });
}));

test('generated updates preserve exact previous bytes in a backup', async () => fixture(async (_, destination, planner, executor) => {
  await mkdir(destination);
  const target = path.join(destination, 'settings.txt');
  await writeFile(target, 'old\r\n');
  const operation = await planner.planGenerated('settings.txt', 100, previous => {
    assert.deepEqual(previous, Buffer.from('old\r\n'));
    return Buffer.from('new\n');
  });
  assert.equal(operation.action, 'update');
  const receipt = await executor.execute([operation]);
  assert.equal(receipt.copied, 1);
  assert.equal(receipt.backups?.length, 1);
  assert.equal(await readFile(path.join(destination, receipt.backups![0]), 'utf8'), 'old\r\n');
  assert.equal(await readFile(target, 'utf8'), 'new\n');
}));

test('copy planning rejects different destination contents and execution rejects changed source bytes', async () => fixture(async (root, destination, planner, executor) => {
  const source = path.join(root, 'source.bin');
  await writeFile(source, 'data');
  const operation = await planner.planCopy('output.bin', source, 4, 100, 'asset');
  await writeFile(source, 'edit');
  await assert.rejects(executor.execute([operation]), /Source changed/);
  await assert.rejects(readFile(path.join(destination, 'output.bin')));
  await writeFile(path.join(destination, 'output.bin'), 'keep');
  await assert.rejects(planner.planCopy('output.bin', source, 4, 100, 'asset'), /Existing asset differs/);
  assert.equal(await readFile(path.join(destination, 'output.bin'), 'utf8'), 'keep');
}));

test('execution rejects changed destination and out-of-root targets', async () => fixture(async (root, destination, planner, executor) => {
  const operation = await planner.planGenerated('file.txt', 100, () => Buffer.from('new'));
  await mkdir(destination);
  await writeFile(path.join(destination, 'file.txt'), 'old');
  await assert.rejects(executor.execute([operation]), /Destination changed/);
  await assert.rejects(planner.planGenerated('../outside.txt', 100, () => Buffer.from('bad')), /Invalid export destination path/);
  await assert.rejects(executor.execute([{ ...operation, relativeDestination: '../outside.txt' }]), /Invalid export destination path/);
  await assert.rejects(readFile(path.join(root, 'outside.txt')));
  assert.equal(await readFile(path.join(destination, 'file.txt'), 'utf8'), 'old');
}));

test('generated output is bounded and partial execution reports completed writes', async () => fixture(async (_, destination, planner, executor) => {
  await assert.rejects(planner.planGenerated('oversize', 2, () => Buffer.from('big')), /size limit/);
  const first = await planner.planGenerated('first', 100, () => Buffer.from('one'));
  const second = await planner.planGenerated('second', 100, () => Buffer.from('two'));
  await mkdir(destination);
  await writeFile(path.join(destination, 'second'), 'old');
  await assert.rejects(executor.execute([first, second]), /Export stopped after 1 file\(s\) written/);
  assert.equal(await readFile(path.join(destination, 'first'), 'utf8'), 'one');
  assert.equal(await readFile(path.join(destination, 'second'), 'utf8'), 'old');
}));

test('destination validation rejects protected roots and resolves paths without creating directories', async () => fixture(async (root, destination) => {
  const scope = new FileDestination(path.join(destination, '.'));
  assert.equal(scope.root, destination);
  assert.equal(scope.resolve('assets/a.bin'), path.join(destination, 'assets', 'a.bin'));
  assert.equal(scope.relative(path.join(destination, 'assets', 'a.bin')), 'assets/a.bin');
  assert.throws(() => scope.resolve('../escape.bin'), /Invalid export destination path/);
  assert.throws(() => scope.relative(path.join(root, 'outside.bin')), /Invalid export destination path/);
  assert.throws(() => new FileDestination('relative'), /absolute destination/);
  await scope.validate([path.join(root, 'source')]);
  await assert.rejects(scope.validate([root]), /overlaps/);
  await assert.rejects(scope.validate([path.join(destination, 'collection')]), /overlaps/);
  await assert.rejects(readdir(destination));
}));

test('a reused destination rechecks parent directories after planning', { skip: process.platform === 'win32' }, async () => fixture(async (root, destination, planner, executor) => {
  const operation = await planner.planGenerated('assets/data.json', 100, () => Buffer.from('{}'));
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await mkdir(destination);
  await symlink(outside, path.join(destination, 'assets'), 'dir');
  await assert.rejects(executor.execute([operation]), /redirected/);
  assert.deepEqual(await readdir(outside), []);
}));
