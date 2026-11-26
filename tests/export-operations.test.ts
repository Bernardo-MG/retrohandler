import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { executeOperations } from '../src/main/export/export-executor';
import { planCopy, planGenerated } from '../src/main/export/export-planner';

async function fixture(run: (root: string, destination: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rh-export-operations-')));
  const destination = path.join(root, 'destination');
  try {
    await run(root, destination);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('generic copy and generated operations create and reuse files without format-specific kinds', async () => fixture(async (root, destination) => {
  const source = path.join(root, 'source.bin');
  await writeFile(source, 'data');
  const copy = await planCopy(destination, 'assets/a.bin', source, 4, 100, 'asset');
  const generated = await planGenerated(destination, 'index.json', 100, previous => {
    assert.equal(previous, null);
    return Buffer.from('{}');
  });
  assert.deepEqual(copy.content, { file: source });
  assert.equal(copy.action, 'create');
  assert.equal(generated.action, 'create');
  await assert.rejects(readdir(destination));
  assert.deepEqual(await executeOperations(destination, [copy, generated]), { copied: 2 });
  assert.equal(await readFile(path.join(destination, 'assets/a.bin'), 'utf8'), 'data');
  const again = await planCopy(destination, 'assets/a.bin', source, 4, 100, 'asset');
  const same = await planGenerated(destination, 'index.json', 100, previous => previous!);
  assert.equal(again.action, 'reuse');
  assert.equal(same.action, 'reuse');
  assert.deepEqual(await executeOperations(destination, [again, same]), { copied: 0 });
}));

test('generated updates preserve exact previous bytes in a backup', async () => fixture(async (_, destination) => {
  await mkdir(destination);
  const target = path.join(destination, 'settings.txt');
  await writeFile(target, 'old\r\n');
  const operation = await planGenerated(destination, 'settings.txt', 100, previous => {
    assert.deepEqual(previous, Buffer.from('old\r\n'));
    return Buffer.from('new\n');
  });
  assert.equal(operation.action, 'update');
  const receipt = await executeOperations(destination, [operation]);
  assert.equal(receipt.copied, 1);
  assert.equal(receipt.backups?.length, 1);
  assert.equal(await readFile(path.join(destination, receipt.backups![0]), 'utf8'), 'old\r\n');
  assert.equal(await readFile(target, 'utf8'), 'new\n');
}));

test('copy planning rejects different destination contents and execution rejects changed source bytes', async () => fixture(async (root, destination) => {
  const source = path.join(root, 'source.bin');
  await writeFile(source, 'data');
  const operation = await planCopy(destination, 'output.bin', source, 4, 100, 'asset');
  await writeFile(source, 'edit');
  await assert.rejects(executeOperations(destination, [operation]), /Source changed/);
  await assert.rejects(readFile(path.join(destination, 'output.bin')));
  await writeFile(path.join(destination, 'output.bin'), 'keep');
  await assert.rejects(planCopy(destination, 'output.bin', source, 4, 100, 'asset'), /Existing asset differs/);
  assert.equal(await readFile(path.join(destination, 'output.bin'), 'utf8'), 'keep');
}));

test('execution rejects changed destination and out-of-root targets', async () => fixture(async (root, destination) => {
  const operation = await planGenerated(destination, 'file.txt', 100, () => Buffer.from('new'));
  await mkdir(destination);
  await writeFile(path.join(destination, 'file.txt'), 'old');
  await assert.rejects(executeOperations(destination, [operation]), /Destination changed/);
  await assert.rejects(planGenerated(destination, '../outside.txt', 100, () => Buffer.from('bad')), /Invalid export destination path/);
  await assert.rejects(executeOperations(destination, [{ ...operation, relativeDestination: '../outside.txt' }]), /Invalid export destination path/);
  await assert.rejects(readFile(path.join(root, 'outside.txt')));
  assert.equal(await readFile(path.join(destination, 'file.txt'), 'utf8'), 'old');
}));

test('generated output is bounded and partial execution reports completed writes', async () => fixture(async (_, destination) => {
  await assert.rejects(planGenerated(destination, 'oversize', 2, () => Buffer.from('big')), /size limit/);
  const first = await planGenerated(destination, 'first', 100, () => Buffer.from('one'));
  const second = await planGenerated(destination, 'second', 100, () => Buffer.from('two'));
  await mkdir(destination);
  await writeFile(path.join(destination, 'second'), 'old');
  await assert.rejects(executeOperations(destination, [first, second]), /Export stopped after 1 file\(s\) written/);
  assert.equal(await readFile(path.join(destination, 'first'), 'utf8'), 'one');
  assert.equal(await readFile(path.join(destination, 'second'), 'utf8'), 'old');
}));
