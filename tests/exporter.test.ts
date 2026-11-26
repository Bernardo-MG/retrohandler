import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ExportOptions, LibraryEntry } from '../src/shared';
import { ExportService, type ExportLibrary, type Exporter } from '../src/main/export';
import { fingerprint, type FileOperation } from '../src/main/export/export-plan';
import { planGenerated } from '../src/main/export/export-planner';
import { mapSystem } from '../src/main/export/retropie/system-mapping';
import { resolveRomLayout } from '../src/main/export/retropie/rom-layout';
import { RetroPieExporter } from '../src/main/export/retropie/retropie-exporter';

const optionsFor = (destination: string): ExportOptions => ({ source: null, destination, includeArtwork: false, overrides: {} });
const libraryFor = (entries: LibraryEntry[]): ExportLibrary => ({
  queryLibrary: async query => ({ items: entries.slice(query.offset, query.offset + query.limit), total: entries.length })
});
const game = (source: string, relativePath: string): LibraryEntry => ({
  id: relativePath, source, relativePath, name: relativePath, system: 'Nintendo Entertainment System', extension: '.zip', bytes: 4
});

async function fixture(run: (root: string, source: string, destination: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rh-exporter-')));
  const source = path.join(root, 'source');
  try {
    await mkdir(source);
    await run(root, source, path.join(root, 'destination'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('RetroPie system mapping respects own overrides and rejects invalid destinations', () => {
  assert.equal(mapSystem('Nintendo Entertainment System', {}), 'nes');
  assert.equal(mapSystem('Nintendo Entertainment System', { 'Nintendo Entertainment System': 'custom' }), 'custom');
  assert.equal(mapSystem('Unknown', Object.create({ Unknown: 'nes' })), null);
  assert.equal(mapSystem('constructor', {}), null);
  for (const invalid of ['', '../escape', 'NES', 'con', 'aux', 'a'.repeat(51)]) {
    assert.equal(mapSystem('Nintendo Entertainment System', { 'Nintendo Entertainment System': invalid }), null);
  }
});

test('RetroPie ROM layout flattens filenames and reports unsupported formats and names', () => {
  const entry = { system: 'Nintendo Entertainment System', relativePath: 'subdir/Game.zip' };
  const expected = { system: 'nes', filename: 'Game.zip', relativeDestination: 'roms/nes/Game.zip' };
  assert.deepEqual(resolveRomLayout(entry, {}), expected);
  assert.deepEqual(resolveRomLayout({ ...entry, relativePath: 'subdir\\Game.zip' }, {}), expected);
  assert.match((resolveRomLayout({ ...entry, system: 'Unknown' }, {}) as { warning: string }).warning, /Unmapped system/);
  assert.match((resolveRomLayout({ ...entry, relativePath: 'Game.7Z' }, {}) as { warning: string }).warning, /compatibility/);
  assert.match((resolveRomLayout({ ...entry, relativePath: 'Game?.zip' }, {}) as { warning: string }).warning, /Unsupported filename/);
});

test('the export workflow accepts an independent strategy and owns the validated destination and fingerprint', async () => fixture(async (_, source, destination) => {
  const entries = [game(source, 'Game.zip')];
  const options = optionsFor(destination);
  let operations: FileOperation[] = [];
  const exporter: Exporter = {
    async prepare(received, receivedOptions, target) {
      assert.deepEqual(received, entries);
      assert.equal(receivedOptions, options);
      assert.equal(target, destination);
      const operation = await planGenerated(target, 'index.json', 100, () => Buffer.from('{}'));
      operations = [operation];
      return {
        plan: {
          files: [
            { source: path.join(source, 'Game.zip'), relativeDestination: 'Game.zip', size: 4, kind: 'rom' },
            { source: '', relativeDestination: operation.relativeDestination, size: operation.size, kind: 'gamelist', action: operation.action }
          ],
          systems: [], warnings: [], conflicts: [], bytes: 0, skippedRoms: 0
        },
        operations: [operation]
      };
    }
  };
  const service = new ExportService(libraryFor(entries), exporter);
  const plan = await service.preview(options);
  assert.equal(plan.destination, destination);
  assert.equal(plan.fingerprint, fingerprint(plan, options, operations));
  assert.equal(operations[0].relativeDestination, 'index.json');
  await assert.rejects(readdir(destination));
  assert.deepEqual(await service.execute(options, plan.fingerprint), { copied: 1 });
  assert.equal(await readFile(path.join(destination, 'index.json'), 'utf8'), '{}');
  await assert.rejects(readFile(path.join(destination, 'Game.zip')));
}));

test('overlapping destinations are rejected before invoking the strategy', async () => fixture(async (_, source) => {
  let called = false;
  const exporter: Exporter = { async prepare() { called = true; throw new Error('unexpected'); } };
  const service = new ExportService(libraryFor([]), exporter);
  await assert.rejects(service.preview({ ...optionsFor(path.join(source, 'export')), source }), /overlaps/);
  assert.equal(called, false);
}));

test('RetroPie strategy returns references separately from executable operations', async () => fixture(async (root, source, destination) => {
  await writeFile(path.join(source, 'Game.zip'), 'data');
  const entries = [game(source, 'Game.zip')];
  const exporter = new RetroPieExporter(path.join(root, 'cache'));
  const draft = await exporter.prepare(entries, optionsFor(destination), destination);
  assert.deepEqual(draft.plan.files.map(file => file.kind), ['rom', 'gamelist']);
  assert.deepEqual(draft.operations.map(operation => operation.relativeDestination), ['roms/nes/gamelist.xml']);
  assert.equal(draft.plan.skippedRoms, 0);
  await assert.rejects(readdir(destination));
}));

test('one export service rejects concurrent execution and releases its lock after success', async () => fixture(async (root, source, destination) => {
  await writeFile(path.join(source, 'Game.zip'), 'data');
  const entries = [game(source, 'Game.zip')];
  const options = optionsFor(destination);
  const target = new RetroPieExporter(path.join(root, 'cache'));
  let block = false;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const exporter: Exporter = {
    async prepare(items, opts, dest) {
      if (block) {
        entered();
        await gate;
      }
      return target.prepare(items, opts, dest);
    }
  };
  const service = new ExportService(libraryFor(entries), exporter);
  const plan = await service.preview(options);
  block = true;
  const running = service.execute(options, plan.fingerprint);
  try {
    await started;
    await assert.rejects(service.execute(options, plan.fingerprint), /Another configuration export is running/);
    // A separate service can execute a different destination without sharing the lock.
    const independent = new ExportService(libraryFor(entries), target);
    const otherOptions = optionsFor(path.join(root, 'other-destination'));
    const otherPreview = await independent.preview(otherOptions);
    assert.deepEqual(await independent.execute(otherOptions, otherPreview.fingerprint), { copied: 1 });
  } finally {
    block = false;
    release();
    await running;
  }
  assert.deepEqual(await running, { copied: 1 });
  const repeat = await service.preview(options);
  assert.deepEqual(await service.execute(options, repeat.fingerprint), { copied: 0 });
}));

test('the export service releases its execution lock after a preparation failure', async () => fixture(async (root, source, destination) => {
  await writeFile(path.join(source, 'Game.zip'), 'data');
  const target = new RetroPieExporter(path.join(root, 'cache'));
  let fail = false;
  const exporter: Exporter = {
    async prepare(items, options, dest) {
      if (fail) throw new Error('Preparation failed');
      return target.prepare(items, options, dest);
    }
  };
  const service = new ExportService(libraryFor([game(source, 'Game.zip')]), exporter);
  const options = optionsFor(destination);
  const preview = await service.preview(options);
  fail = true;
  await assert.rejects(service.execute(options, preview.fingerprint), /Preparation failed/);
  await assert.rejects(readdir(destination));
  fail = false;
  assert.deepEqual(await service.execute(options, preview.fingerprint), { copied: 1 });
}));
