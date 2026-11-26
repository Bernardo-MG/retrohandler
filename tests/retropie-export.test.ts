import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ExportOptions, LibraryEntry } from '../src/shared';
import { ExportService, type ExportLibrary } from '../src/main/export';
import { RetroPieExporter } from '../src/main/export/retropie/retropie-exporter';
import { ArtworkCache } from '../src/main/components/artwork/artwork-cache';
import { RetroPieGameList } from '../src/main/export/retropie/retropie-gamelist';
import { RetroPieLayout } from '../src/main/export/retropie/retropie-layout';

const gamelist = new RetroPieGameList(new RetroPieLayout({}), 'nes');

const entry = (source: string, relativePath: string, system = 'Nintendo Entertainment System'): LibraryEntry => ({
  id: relativePath, name: 'A & B <Game>', system, source, relativePath, extension: '.zip', bytes: 4,
  metadata: { source, relativePath, title: 'Hello & <World>', description: 'Line <1> & next', released: '1992-03-04',
    developer: 'A & B', publisher: '', genre: '', provider: 'manual', providerId: null, providerSlug: null, artworkId: null }
});
const library = (items: LibraryEntry[]): ExportLibrary => ({
  queryLibrary: async q => ({ items: items.filter(x => q.source === null || q.source === x.source).slice(q.offset, q.offset + q.limit), total: items.filter(x => q.source === null || x.source === q.source).length })
});
const options = (destination: string): ExportOptions => ({ source: null, destination, includeArtwork: false, overrides: {} });

async function fixture(fn: (root: string, source: string, destination: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-export-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  await mkdir(source);
  try { await fn(root, source, destination); }
  finally { await rm(root, {recursive: true, force: true}); }
}

test('gamelist contains escaped metadata and relative image paths', () => {
  const xml = gamelist.generateOrMerge([{entry: entry('/roms', 'foo.zip'), filename: 'foo.zip', image: 'a.png'}], null).toString('utf8');
  assert.match(xml, /<name>Hello &amp; &lt;World&gt;<\/name>/);
  assert.match(xml, /<desc>Line &lt;1&gt; &amp; next<\/desc>/);
  assert.match(xml, /<releasedate>19920304T000000<\/releasedate>/);
  assert.match(xml, /<image>\.\/images\/a.png<\/image>/);
});

test('release year and year-month are exported as valid EmulationStation dates', () => {
  const game = entry('/roms', 'Game.zip');
  const render = (released: string) => {
    game.metadata = { ...game.metadata!, released };
    return gamelist.generateOrMerge([{ entry: game, filename: 'Game.zip', image: null }], null).toString('utf8');
  };
  assert.match(render('1992'), /<releasedate>19920101T000000<\/releasedate>/);
  assert.match(render('1992-03'), /<releasedate>19920301T000000<\/releasedate>/);
  assert.match(render('1992-03-04'), /<releasedate>19920304T000000<\/releasedate>/);
  assert.match(render('2000-02-29'), /<releasedate>20000229T000000<\/releasedate>/);
  assert.match(render(' 1992 '), /<releasedate>19920101T000000<\/releasedate>/);
});

test('invalid or impossible release dates are omitted', () => {
  const game = entry('/roms', 'Game.zip');
  for (const released of ['', '0000', '1992-00', '1992-13', '1992-02-30',
    '1900-02-29', '1992-04-31', '1992-1', '1992/03', 'about 1992']) {
    game.metadata = { ...game.metadata!, released };
    const xml = gamelist.generateOrMerge([{ entry: game, filename: 'Game.zip', image: null }], null).toString('utf8');
    assert.doesNotMatch(xml, /<releasedate>/, `invalid date: ${released}`);
  }
});

test('preview makes no files; confirmed export writes XML but never copies ROMs', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'Game.zip'), 'data');
  const lib = library([entry(src, 'Game.zip')]);
  const service = new ExportService(lib, new RetroPieExporter(new ArtworkCache(path.join(src, 'artwork'))));
  const plan = await service.preview(options(dst));
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.warnings.length, 0);
  assert.equal(plan.files.length, 2);
  await assert.rejects(readdir(dst));
  assert.equal(plan.bytes, 0); // No ROM content is copied in configuration-only mode.
  assert.deepEqual(await service.execute(options(dst), plan.fingerprint), {copied: 1});
  await assert.rejects(readFile(path.join(dst, 'roms', 'nes', 'Game.zip')));
  assert.match(await readFile(path.join(dst, 'roms', 'nes', 'gamelist.xml'), 'utf8'), /\.\/Game.zip/);
  assert.equal((await readFile(path.join(src, 'Game.zip'))).toString(), 'data');
}));

test('existing destination ROM is preserved and referenced without overwrite', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'A.zip'), 'new!');
  await mkdir(path.join(dst, 'roms', 'nes'), {recursive: true});
  await writeFile(path.join(dst, 'roms', 'nes', 'A.zip'), 'keep');
  const lib = library([entry(src, 'A.zip')]);
  const service = new ExportService(lib, new RetroPieExporter(new ArtworkCache(path.join(src,'artwork'))));
  const plan = await service.preview(options(dst));
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(await service.execute(options(dst), plan.fingerprint), {copied: 1});
  assert.equal(await readFile(path.join(dst, 'roms', 'nes', 'A.zip'), 'utf8'), 'keep');
  assert.match(await readFile(path.join(dst, 'roms', 'nes', 'gamelist.xml'), 'utf8'), /A.zip/);
}));

test('duplicate names from different collections are reported as warnings', async () => fixture(async (root, src, dst) => {
  const other = path.join(root, 'second'); await mkdir(other);
  await writeFile(path.join(src, 'Same.zip'), 'aaaa');
  await writeFile(path.join(other, 'Same.zip'), 'bbbb');
  const service = new ExportService(library([entry(src,'Same.zip'),entry(other,'Same.zip')]), new RetroPieExporter(new ArtworkCache(path.join(root,'art'))));
  const plan = await service.preview(options(dst));
  assert.ok(plan.warnings.some(x => x.includes('Filename collision')));
  assert.equal(plan.files.filter(x => x.kind === 'rom').length, 1);
}));

test('unknown platform can be configured, and overlapping destination rejected', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'Mystery.zip'), 'data');
  const lib = library([entry(src,'Mystery.zip','Needs identification')]);
  const service = new ExportService(lib, new RetroPieExporter(new ArtworkCache(path.join(src,'art'))));
  const plan = await service.preview(options(dst));
  assert.ok(plan.warnings.some(x => x.includes('Unmapped')));
  const mapped = await service.preview({...options(dst), overrides:{'Needs identification':'nes'}});
  assert.equal(mapped.warnings.length, 0);
  await assert.rejects(service.preview(options(path.join(src,'export'))), /overlaps/);
}));

test('an export cannot run with an outdated preview', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src,'Game.zip'), 'data');
  const lib = library([entry(src,'Game.zip')]);
  const service = new ExportService(lib, new RetroPieExporter(new ArtworkCache(path.join(src,'art'))));
  const plan = await service.preview(options(dst));
  await assert.rejects(service.execute({...options(dst),includeArtwork: true}, plan.fingerprint), /changed/);
}));

test('preview paginates large libraries instead of exporting only the visible page', async () => fixture(async (_, src, dst) => {
  const items: LibraryEntry[] = [];
  for (let i = 0; i < 205; i++) {
    const name = `Game-${i}.zip`;
    await writeFile(path.join(src, name), 'data');
    items.push(entry(src, name));
  }
  const service = new ExportService(library(items), new RetroPieExporter(new ArtworkCache(path.join(src, 'artwork'))));
  const plan = await service.preview(options(dst));
  assert.equal(plan.files.filter(file => file.kind === 'rom').length, 205);
  assert.equal(plan.warnings.length, 0);
}));

test('unsafe relative paths cannot escape the ROM source directory', async () => fixture(async (root, src, dst) => {
  await writeFile(path.join(root, 'outside.zip'), 'data');
  const service = new ExportService(library([entry(src, '../outside.zip')]), new RetroPieExporter(new ArtworkCache(path.join(src,'artwork'))));
  const plan = await service.preview(options(dst));
  assert.ok(plan.warnings.some(message => message.includes('Unsafe source')));
  assert.equal(plan.files.length, 0);
}));

test('export uses effective per-ROM metadata system rather than scanner system', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'Unidentified.zip'), 'data');
  const game = entry(src, 'Unidentified.zip', 'Needs identification');
  game.system = 'Super Nintendo'; // Effective system returned by the SQLite library browser.
  game.metadata = { ...game.metadata!, systemOverride: 'Super Nintendo' };
  const service = new ExportService(library([game]), new RetroPieExporter(new ArtworkCache(path.join(src, 'artwork'))));
  const plan = await service.preview(options(dst));
  assert.equal(plan.warnings.length, 0);
  assert.ok(plan.files.some(f => f.relativeDestination === 'roms/snes/Unidentified.zip'));
  await service.execute(options(dst), plan.fingerprint);
  await assert.rejects(readFile(path.join(dst, 'roms', 'snes', 'Unidentified.zip')));
  assert.match(await readFile(path.join(dst, 'roms', 'snes', 'gamelist.xml'), 'utf8'), /Unidentified.zip/);
}));


test('export skips unmapped games and writes gamelist only for approved ROMs', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'Ready.zip'), 'ready');
  await writeFile(path.join(src, 'Unmapped.zip'), 'unknown');
  const lib = library([entry(src, 'Ready.zip'), entry(src, 'Unmapped.zip', 'Needs identification')]);
  const service = new ExportService(lib, new RetroPieExporter(new ArtworkCache(path.join(src, 'artwork'))));
  const plan = await service.preview(options(dst));
  assert.equal(plan.files.filter(f => f.kind === 'rom').length, 1);
  assert.ok(plan.warnings.some(w => w.includes('Unmapped system')));
  assert.deepEqual(await service.execute(options(dst), plan.fingerprint), {copied: 1});
  const xml = await readFile(path.join(dst, 'roms', 'nes', 'gamelist.xml'), 'utf8');
  assert.match(xml, /Ready.zip/);
  assert.doesNotMatch(xml, /Unmapped.zip/);
  await assert.rejects(readFile(path.join(dst, 'roms', 'nes', 'Unmapped.zip')));
  assert.equal(await readFile(path.join(src, 'Unmapped.zip'), 'utf8'), 'unknown');
}));

test('skipped duplicate names are excluded from gamelist', async () => fixture(async (root, src, dst) => {
  const other = path.join(root, 'other');
  await mkdir(other);
  await writeFile(path.join(src, 'Same.zip'), 'first');
  await writeFile(path.join(other, 'Same.zip'), 'second');
  const lib = library([entry(src, 'Same.zip'), entry(other, 'Same.zip')]);
  const service = new ExportService(lib, new RetroPieExporter(new ArtworkCache(path.join(root, 'artwork'))));
  const plan = await service.preview(options(dst));
  assert.ok(plan.warnings.some(w => w.includes('Filename collision')));
  await service.execute(options(dst), plan.fingerprint);
  const xml = await readFile(path.join(dst, 'roms', 'nes', 'gamelist.xml'), 'utf8');
  assert.equal((xml.match(/<game>/g) ?? []).length, 1);
}));

test('when all systems are unmapped there is nothing to export', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'Unmapped.zip'), 'data');
  const lib = library([entry(src, 'Unmapped.zip', 'Needs identification')]);
  const service = new ExportService(lib, new RetroPieExporter(new ArtworkCache(path.join(src, 'artwork'))));
  const plan = await service.preview(options(dst));
  assert.equal(plan.files.length, 0);
  await assert.rejects(service.execute(options(dst), plan.fingerprint), /No exportable ROMs/);
}));
