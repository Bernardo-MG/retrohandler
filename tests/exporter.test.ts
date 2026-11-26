import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ExportOptions, LibraryEntry } from '../src/shared';
import { ExportService, type ExportLibrary, type Exporter } from '../src/main/export';
import { finalizeExport, fingerprint, type ExportDraft, type FileOperation } from '../src/main/export/export-plan';
import { planGenerated } from '../src/main/export/export-planner';
import { readLibraryEntries } from '../src/main/export/library-reader';
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
    async prepare(received, receivedOptions) {
      assert.deepEqual(received, entries);
      assert.deepEqual(receivedOptions, { destination, includeArtwork: false, overrides: {} });
      const operation = await planGenerated(receivedOptions.destination, 'index.json', 100, () => Buffer.from('{}'));
      operations = [operation];
      return {
        plan: {
          files: [
            { source: path.join(source, 'Game.zip'), relativeDestination: 'Game.zip', size: 4, kind: 'rom' },
            { source: '', relativeDestination: operation.relativeDestination, size: 0, kind: 'gamelist' }
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
  assert.equal(plan.files[1].size, 2);
  assert.equal(plan.files[1].action, 'create');
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
  const draft = await exporter.prepare(entries, { destination, includeArtwork: false, overrides: {} });
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
    async prepare(items, opts) {
      if (block) {
        entered();
        await gate;
      }
      return target.prepare(items, opts);
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
    async prepare(items, options) {
      if (fail) throw new Error('Preparation failed');
      return target.prepare(items, options);
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


test('export finalization rejects unlisted, missing, duplicate and ROM write operations', async () => fixture(async (_, source, destination) => {
  const options = optionsFor(destination);
  const operation = await planGenerated(destination, 'Game.zip', 100, () => Buffer.from('new'));
  const draft: ExportDraft = {
    plan: {
      files: [{ source: path.join(source, 'Game.zip'), relativeDestination: 'Game.zip', size: 4, kind: 'rom' }],
      systems: [], warnings: [], conflicts: [], bytes: 0, skippedRoms: 0
    },
    operations: [operation]
  };
  assert.throws(() => finalizeExport(draft, options, destination), /ROM reference cannot be an export operation/);
  assert.throws(() => finalizeExport({ ...draft, plan: { ...draft.plan, files: [] } }, options, destination), /missing from preview/);
  assert.throws(() => finalizeExport({ ...draft, operations: [operation, operation] }, options, destination), /Duplicate export operation/);
  const file = { source: '', relativeDestination: 'Game.zip', size: 0, kind: 'gamelist' as const };
  const missing = { ...draft, operations: [], plan: { ...draft.plan, files: [file] } };
  assert.throws(() => finalizeExport(missing, options, destination), /Export operation missing/);
  const conflicted = { ...missing, plan: { ...missing.plan, conflicts: ['Existing destination conflict'] } };
  assert.deepEqual(finalizeExport(conflicted, options, destination).plan.files, [file]);
  const duplicate = { ...draft, plan: { ...draft.plan, files: [file, { ...file, relativeDestination: 'game.zip' }] } };
  assert.throws(() => finalizeExport(duplicate, options, destination), /Duplicate export destination/);
  await assert.rejects(readdir(destination));
}));

test('library pagination uses actual returned counts and never skips short pages', async () => {
  const entries = Array.from({ length: 5 }, (_, i) => game('/collection', `${i}.zip`));
  const offsets: number[] = [];
  const library: ExportLibrary = {
    async queryLibrary(query) {
      offsets.push(query.offset);
      return { items: entries.slice(query.offset, query.offset + 2), total: entries.length };
    }
  };
  assert.deepEqual(await readLibraryEntries(library, null), entries);
  assert.deepEqual(offsets, [0, 2, 4]);
});

test('library pagination rejects oversized or stalled results', async () => {
  const item = game('/collection', 'Game.zip');
  const oversized: ExportLibrary = { queryLibrary: async () => ({ items: [item], total: 250001 }) };
  const stalled: ExportLibrary = { queryLibrary: async () => ({ items: [], total: 1 }) };
  await assert.rejects(readLibraryEntries(oversized, null), /Library changed during export preview/);
  await assert.rejects(readLibraryEntries(stalled, null), /Library changed during export preview/);
});
