import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ExportOptions, LibraryEntry } from '../../src/shared';
import { ExportService, type ExportLibrary, type Exporter } from '../../src/main/export';
import { FileDestination } from '../../src/main/components/file-operations/file-destination';
import type { FileOperation } from '../../src/main/components/file-operations/file-operation';
import { FileOperationPlanner } from '../../src/main/components/file-operations/file-operation-planner';
import { PreparedExport, type ExportDraft } from '../../src/main/export/prepared-export';
import { RetroPieLayout } from '../../src/main/export/retropie/retropie-layout';
import { RetroPieExporter } from '../../src/main/export/retropie/retropie-exporter';
import { createTestImageCache } from '../helpers/image-cache';

const optionsFor = (destination: string): ExportOptions => ({
  source: null,
  destination,
  includeArtwork: false,
  overrides: {}
});
const libraryFor = (entries: LibraryEntry[]): ExportLibrary => ({
  queryLibrary: async (query) => ({
    items: entries.slice(query.offset, query.offset + query.limit),
    total: entries.length
  })
});
const game = (source: string, relativePath: string): LibraryEntry => ({
  id: relativePath,
  source,
  relativePath,
  name: relativePath,
  system: 'Nintendo Entertainment System',
  extension: '.zip',
  bytes: 4
});

async function fixture(
  run: (root: string, source: string, destination: string) => Promise<void>
): Promise<void> {
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
  const entry = { system: 'Nintendo Entertainment System', relativePath: 'Game.zip' };
  assert.deepEqual(new RetroPieLayout({}).resolveRomDestination(entry), {
    system: 'nes',
    filename: 'Game.zip',
    relativeDestination: 'roms/nes/Game.zip'
  });
  assert.deepEqual(
    new RetroPieLayout({ 'Nintendo Entertainment System': 'custom' }).resolveRomDestination(entry),
    {
      system: 'custom',
      filename: 'Game.zip',
      relativeDestination: 'roms/custom/Game.zip'
    }
  );
  assert.deepEqual(
    new RetroPieLayout(Object.create({ Unknown: 'nes' })).resolveRomDestination({
      ...entry,
      system: 'Unknown'
    }),
    { warning: 'Unmapped system: Unknown' }
  );
  assert.deepEqual(new RetroPieLayout({}).resolveRomDestination({ ...entry, system: 'constructor' }), {
    warning: 'Unmapped system: constructor'
  });
  for (const invalid of ['', '../escape', 'NES', 'con', 'aux', 'a'.repeat(51)]) {
    assert.deepEqual(
      new RetroPieLayout({ 'Nintendo Entertainment System': invalid }).resolveRomDestination(entry),
      { warning: 'Unmapped system: Nintendo Entertainment System' }
    );
  }
});

test('RetroPie ROM layout flattens filenames and reports unsupported formats and names', () => {
  const layout = new RetroPieLayout({});
  const entry = { system: 'Nintendo Entertainment System', relativePath: 'subdir/Game.zip' };
  const expected = { system: 'nes', filename: 'Game.zip', relativeDestination: 'roms/nes/Game.zip' };
  assert.deepEqual(layout.resolveRomDestination(entry), expected);
  assert.deepEqual(layout.resolveRomDestination({ ...entry, relativePath: 'subdir\\Game.zip' }), expected);
  assert.match(
    (layout.resolveRomDestination({ ...entry, system: 'Unknown' }) as { warning: string }).warning,
    /Unmapped system/
  );
  assert.match(
    (layout.resolveRomDestination({ ...entry, relativePath: 'Game.7Z' }) as { warning: string }).warning,
    /compatibility/
  );
  assert.match(
    (layout.resolveRomDestination({ ...entry, relativePath: 'Game?.zip' }) as { warning: string }).warning,
    /Unsupported filename/
  );
});

test('the export workflow accepts an independent strategy and owns the validated destination and fingerprint', async () =>
  fixture(async (_, source, destination) => {
    const entries = [game(source, 'Game.zip')];
    const options = optionsFor(destination);
    let operations: FileOperation[] = [];
    const exporter: Exporter = {
      async prepareDraft(received, receivedOptions) {
        assert.deepEqual(received, entries);
        assert.equal(receivedOptions.destination.root, destination);
        assert.deepEqual(
          { includeArtwork: receivedOptions.includeArtwork, overrides: receivedOptions.overrides },
          { includeArtwork: false, overrides: {} }
        );
        const operation = await new FileOperationPlanner(receivedOptions.destination).planGeneratedFile({
          relativeDestination: 'index.json',
          maxBytes: 100,
          generate: () => Buffer.from('{}')
        });
        operations = [operation];
        return {
          plan: {
            files: [
              {
                source: path.join(source, 'Game.zip'),
                relativeDestination: 'Game.zip',
                size: 4,
                kind: 'rom'
              },
              { source: '', relativeDestination: operation.relativeDestination, size: 0, kind: 'gamelist' }
            ],
            systems: [],
            warnings: [],
            conflicts: [],
            bytes: 0,
            skippedRoms: 0
          },
          operations: [operation]
        };
      }
    };
    const service = new ExportService(libraryFor(entries), exporter);
    const plan = await service.preview(options);
    assert.equal(plan.destination, destination);
    // Check the established fingerprint format independently of PreparedExport.
    const { files, warnings, conflicts } = plan;
    const versions = operations.map((job) => [job.relativeDestination, job.previousHash, job.outputHash]);
    assert.equal(
      plan.fingerprint,
      createHash('sha256')
        .update(JSON.stringify({ destination, files, warnings, conflicts, options, versions }))
        .digest('hex')
    );
    assert.equal(operations[0].relativeDestination, 'index.json');
    assert.equal(plan.files[1].size, 2);
    assert.equal(plan.files[1].action, 'create');
    await assert.rejects(readdir(destination));
    assert.deepEqual(await service.execute(options, plan.fingerprint), { copied: 1 });
    assert.equal(await readFile(path.join(destination, 'index.json'), 'utf8'), '{}');
    await assert.rejects(readFile(path.join(destination, 'Game.zip')));
  }));

test('overlapping destinations are rejected before invoking the strategy', async () =>
  fixture(async (_, source) => {
    let called = false;
    const exporter: Exporter = {
      async prepareDraft() {
        called = true;
        throw new Error('unexpected');
      }
    };
    const service = new ExportService(libraryFor([]), exporter);
    await assert.rejects(service.preview({ ...optionsFor(path.join(source, 'export')), source }), /overlaps/);
    assert.equal(called, false);
  }));

test('RetroPie strategy returns references separately from executable operations', async () =>
  fixture(async (root, source, destination) => {
    await writeFile(path.join(source, 'Game.zip'), 'data');
    const entries = [game(source, 'Game.zip')];
    const exporter = new RetroPieExporter(createTestImageCache(path.join(root, 'cache')));
    const draft = await exporter.prepareDraft(entries, {
      destination: new FileDestination(destination),
      includeArtwork: false,
      overrides: {}
    });
    assert.deepEqual(
      draft.plan.files.map((file) => file.kind),
      ['rom', 'gamelist']
    );
    assert.deepEqual(
      draft.operations.map((operation) => operation.relativeDestination),
      ['roms/nes/gamelist.xml']
    );
    assert.equal(draft.plan.skippedRoms, 0);
    await assert.rejects(readdir(destination));
  }));

test('one export service rejects concurrent execution and releases its lock after success', async () =>
  fixture(async (root, source, destination) => {
    await writeFile(path.join(source, 'Game.zip'), 'data');
    const entries = [game(source, 'Game.zip')];
    const options = optionsFor(destination);
    const target = new RetroPieExporter(createTestImageCache(path.join(root, 'cache')));
    let block = false;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exporter: Exporter = {
      async prepareDraft(items, opts) {
        if (block) {
          entered();
          await gate;
        }
        return target.prepareDraft(items, opts);
      }
    };
    const service = new ExportService(libraryFor(entries), exporter);
    const plan = await service.preview(options);
    block = true;
    const running = service.execute(options, plan.fingerprint);
    try {
      await started;
      await assert.rejects(
        service.execute(options, plan.fingerprint),
        /Another configuration export is running/
      );
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

test('the export service releases its execution lock after a preparation failure', async () =>
  fixture(async (root, source, destination) => {
    await writeFile(path.join(source, 'Game.zip'), 'data');
    const target = new RetroPieExporter(createTestImageCache(path.join(root, 'cache')));
    let fail = false;
    const exporter: Exporter = {
      async prepareDraft(items, options) {
        if (fail) throw new Error('Preparation failed');
        return target.prepareDraft(items, options);
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

test('export finalization rejects unlisted, missing, duplicate and ROM write operations', async () =>
  fixture(async (_, source, destination) => {
    const options = optionsFor(destination);
    const scope = new FileDestination(destination);
    const operation = await new FileOperationPlanner(scope).planGeneratedFile({
      relativeDestination: 'Game.zip',
      maxBytes: 100,
      generate: () => Buffer.from('new')
    });
    const draft: ExportDraft = {
      plan: {
        files: [
          { source: path.join(source, 'Game.zip'), relativeDestination: 'Game.zip', size: 4, kind: 'rom' }
        ],
        systems: [],
        warnings: [],
        conflicts: [],
        bytes: 0,
        skippedRoms: 0
      },
      operations: [operation]
    };
    assert.throws(
      () => PreparedExport.fromDraft(draft, options, scope),
      /ROM reference cannot be an export operation/
    );
    assert.throws(
      () => PreparedExport.fromDraft({ ...draft, plan: { ...draft.plan, files: [] } }, options, scope),
      /missing from preview/
    );
    assert.throws(
      () => PreparedExport.fromDraft({ ...draft, operations: [operation, operation] }, options, scope),
      /Duplicate export operation/
    );
    const file = { source: '', relativeDestination: 'Game.zip', size: 0, kind: 'gamelist' as const };
    const missing = { ...draft, operations: [], plan: { ...draft.plan, files: [file] } };
    assert.throws(() => PreparedExport.fromDraft(missing, options, scope), /Export operation missing/);
    const conflicted = {
      ...missing,
      plan: { ...missing.plan, conflicts: ['Existing destination conflict'] }
    };
    assert.deepEqual(PreparedExport.fromDraft(conflicted, options, scope).plan.files, [file]);
    const duplicate = {
      ...draft,
      plan: { ...draft.plan, files: [file, { ...file, relativeDestination: 'game.zip' }] }
    };
    assert.throws(() => PreparedExport.fromDraft(duplicate, options, scope), /Duplicate export destination/);
    await assert.rejects(readdir(destination));
  }));

test('library pagination uses actual returned counts and never skips short pages', async () =>
  fixture(async (_, source, destination) => {
    const entries = Array.from({ length: 5 }, (_, i) => game(source, `${i}.zip`));
    const offsets: number[] = [];
    const library: ExportLibrary = {
      async queryLibrary(query) {
        offsets.push(query.offset);
        return { items: entries.slice(query.offset, query.offset + 2), total: entries.length };
      }
    };
    let received: readonly LibraryEntry[] = [];
    const exporter: Exporter = {
      async prepareDraft(items) {
        received = items;
        return {
          plan: { files: [], systems: [], warnings: [], conflicts: [], bytes: 0, skippedRoms: items.length },
          operations: []
        };
      }
    };
    await new ExportService(library, exporter).preview(optionsFor(destination));
    assert.deepEqual(received, entries);
    assert.deepEqual(offsets, [0, 2, 4]);
  }));

test('library pagination rejects oversized or stalled results', async () =>
  fixture(async (_, source, destination) => {
    const item = game(source, 'Game.zip');
    const oversized: ExportLibrary = { queryLibrary: async () => ({ items: [item], total: 250001 }) };
    const stalled: ExportLibrary = { queryLibrary: async () => ({ items: [], total: 1 }) };
    const exporter: Exporter = {
      async prepareDraft() {
        throw new Error('Strategy must not run');
      }
    };
    await assert.rejects(
      new ExportService(oversized, exporter).preview(optionsFor(destination)),
      /Library changed during export preview/
    );
    await assert.rejects(
      new ExportService(stalled, exporter).preview(optionsFor(destination)),
      /Library changed during export preview/
    );
  }));

test('RetroPie layout consistently resolves references and target paths for the same system', () => {
  const layout = new RetroPieLayout({ Custom: 'custom' });
  assert.deepEqual(layout.resolveRomDestination({ system: 'Custom', relativePath: 'nested/Game.zip' }), {
    system: 'custom',
    filename: 'Game.zip',
    relativeDestination: 'roms/custom/Game.zip'
  });
  assert.equal(layout.artworkDestination('custom', 'cover.png'), 'roms/custom/images/cover.png');
  assert.equal(layout.gameListDestination('custom'), 'roms/custom/gamelist.xml');
  assert.equal(layout.romReference('Game.zip'), './Game.zip');
  assert.equal(layout.artworkReference('cover.png'), './images/cover.png');
  assert.equal(layout.normalizeGameReference('~/RetroPie/roms/custom/Game.zip', 'custom'), 'Game.zip');
  assert.equal(layout.normalizeGameReference('/home/pi/RetroPie/roms/nes/Game.zip', 'custom'), null);
  assert.equal(layout.normalizeGameReference('../Game.zip', 'custom'), null);
});

test('concurrent drafts from one RetroPie exporter keep their layout and files independent', async () =>
  fixture(async (root, source, destination) => {
    await writeFile(path.join(source, 'First.zip'), 'data');
    await writeFile(path.join(source, 'Second.zip'), 'data');
    const exporter = new RetroPieExporter(createTestImageCache(path.join(root, 'cache')));
    const otherDestination = path.join(root, 'other-destination');
    const [first, second] = await Promise.all([
      exporter.prepareDraft([game(source, 'First.zip')], {
        destination: new FileDestination(destination),
        includeArtwork: false,
        overrides: { 'Nintendo Entertainment System': 'first' }
      }),
      exporter.prepareDraft([game(source, 'Second.zip')], {
        destination: new FileDestination(otherDestination),
        includeArtwork: false,
        overrides: { 'Nintendo Entertainment System': 'second' }
      })
    ]);
    assert.deepEqual(
      first.plan.files.map((file) => file.relativeDestination),
      ['roms/first/First.zip', 'roms/first/gamelist.xml']
    );
    assert.deepEqual(
      second.plan.files.map((file) => file.relativeDestination),
      ['roms/second/Second.zip', 'roms/second/gamelist.xml']
    );
    assert.deepEqual(
      first.operations.map((operation) => operation.relativeDestination),
      ['roms/first/gamelist.xml']
    );
    assert.deepEqual(
      second.operations.map((operation) => operation.relativeDestination),
      ['roms/second/gamelist.xml']
    );
    assert.deepEqual(first.plan.warnings, []);
    assert.deepEqual(second.plan.warnings, []);
    await assert.rejects(readdir(destination));
    await assert.rejects(readdir(otherDestination));
  }));
