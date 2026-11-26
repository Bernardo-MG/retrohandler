import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ExportOptions, LibraryEntry } from '../src/shared';
import { prepareExport, type ExportLibrary } from '../src/main/export/export';
import { fingerprint } from '../src/main/export/export-plan';
import type { Exporter } from '../src/main/export/exporter';
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
  const exporter: Exporter = {
    async prepare(received, receivedOptions, target) {
      assert.deepEqual(received, entries);
      assert.equal(receivedOptions, options);
      assert.equal(target, destination);
      const operation = await planGenerated(target, 'index.json', 100, () => Buffer.from('{}'));
      return {
        plan: {
          files: [{ source: '', relativeDestination: operation.relativeDestination, size: operation.size, kind: 'gamelist', action: operation.action }],
          systems: [], warnings: [], conflicts: [], bytes: 0, skippedRoms: 0
        },
        operations: [operation]
      };
    }
  };
  const prepared = await prepareExport(libraryFor(entries), options, exporter);
  assert.equal(prepared.plan.destination, destination);
  assert.equal(prepared.plan.fingerprint, fingerprint(prepared.plan, options, prepared.operations));
  assert.equal(prepared.operations[0].relativeDestination, 'index.json');
  await assert.rejects(readdir(destination));
}));

test('overlapping destinations are rejected before invoking the strategy', async () => fixture(async (_, source) => {
  let called = false;
  const exporter: Exporter = { async prepare() { called = true; throw new Error('unexpected'); } };
  await assert.rejects(prepareExport(libraryFor([]), { ...optionsFor(path.join(source, 'export')), source }, exporter), /overlaps/);
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
