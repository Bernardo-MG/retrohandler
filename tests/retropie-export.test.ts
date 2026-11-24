import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ExportOptions, LibraryEntry } from '../src/shared';
import { executeExport, gameListXml, previewExport, type ExportLibrary } from '../src/main/export/export';

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
  const xml = gameListXml([{entry: entry('/roms', 'foo.zip'), filename: 'foo.zip', image: 'a.png'}]);
  assert.match(xml, /<name>Hello &amp; &lt;World&gt;<\/name>/);
  assert.match(xml, /<desc>Line &lt;1&gt; &amp; next<\/desc>/);
  assert.match(xml, /<releasedate>19920304T000000<\/releasedate>/);
  assert.match(xml, /<image>\.\/images\/a.png<\/image>/);
});

test('preview makes no files; confirmed export copies intact ROM and writes XML', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'Game.zip'), 'data');
  const lib = library([entry(src, 'Game.zip')]);
  const plan = await previewExport(lib, options(dst), path.join(src, 'artwork'));
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.warnings.length, 0);
  assert.equal(plan.files.length, 2);
  await assert.rejects(readdir(dst));
  assert.deepEqual(await executeExport(lib, options(dst), path.join(src, 'artwork'), plan.fingerprint), {copied: 2});
  assert.equal((await readFile(path.join(dst, 'roms', 'nes', 'Game.zip'))).toString(), 'data');
  assert.match(await readFile(path.join(dst, 'roms', 'nes', 'gamelist.xml'), 'utf8'), /\.\/Game.zip/);
  assert.equal((await readFile(path.join(src, 'Game.zip'))).toString(), 'data');
}));

test('destination existing file blocks export without overwrite', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'A.zip'), 'new!');
  await mkdir(path.join(dst, 'roms', 'nes'), {recursive: true});
  await writeFile(path.join(dst, 'roms', 'nes', 'A.zip'), 'keep');
  const lib = library([entry(src, 'A.zip')]);
  const plan = await previewExport(lib, options(dst), path.join(src,'artwork'));
  assert.deepEqual(plan.conflicts, ['roms/nes/A.zip']);
  await assert.rejects(executeExport(lib, options(dst), path.join(src,'artwork'), plan.fingerprint), /conflicts/);
  assert.equal(await readFile(path.join(dst, 'roms', 'nes', 'A.zip'), 'utf8'), 'keep');
}));

test('duplicate names from different collections are reported as warnings', async () => fixture(async (root, src, dst) => {
  const other = path.join(root, 'second'); await mkdir(other);
  await writeFile(path.join(src, 'Same.zip'), 'aaaa');
  await writeFile(path.join(other, 'Same.zip'), 'bbbb');
  const plan = await previewExport(library([entry(src,'Same.zip'),entry(other,'Same.zip')]), options(dst), path.join(root,'art'));
  assert.ok(plan.warnings.some(x => x.includes('Filename collision')));
  assert.equal(plan.files.filter(x => x.kind === 'rom').length, 1);
}));

test('unknown platform can be configured, and overlapping destination rejected', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src, 'Mystery.zip'), 'data');
  const lib = library([entry(src,'Mystery.zip','Needs identification')]);
  const plan = await previewExport(lib, options(dst), path.join(src,'art'));
  assert.ok(plan.warnings.some(x => x.includes('Unmapped')));
  const mapped = await previewExport(lib, {...options(dst), overrides:{'Needs identification':'nes'}}, path.join(src,'art'));
  assert.equal(mapped.warnings.length, 0);
  await assert.rejects(previewExport(lib, options(path.join(src,'export')), path.join(src,'art')), /overlaps/);
}));

test('an export cannot run with an outdated preview', async () => fixture(async (_, src, dst) => {
  await writeFile(path.join(src,'Game.zip'), 'data');
  const lib = library([entry(src,'Game.zip')]);
  const plan = await previewExport(lib, options(dst), path.join(src,'art'));
  await assert.rejects(executeExport(lib, {...options(dst),includeArtwork: true}, path.join(src,'art'), plan.fingerprint), /changed/);
}));

test('preview paginates large libraries instead of exporting only the visible page', async () => fixture(async (_, src, dst) => {
  const items: LibraryEntry[] = [];
  for (let i = 0; i < 205; i++) {
    const name = `Game-${i}.zip`;
    await writeFile(path.join(src, name), 'data');
    items.push(entry(src, name));
  }
  const plan = await previewExport(library(items), options(dst), path.join(src, 'artwork'));
  assert.equal(plan.files.filter(file => file.kind === 'rom').length, 205);
  assert.equal(plan.warnings.length, 0);
}));

test('unsafe relative paths cannot escape the ROM source directory', async () => fixture(async (root, src, dst) => {
  await writeFile(path.join(root, 'outside.zip'), 'data');
  const plan = await previewExport(library([entry(src, '../outside.zip')]), options(dst), path.join(src,'artwork'));
  assert.ok(plan.warnings.some(message => message.includes('Unsafe source')));
  assert.equal(plan.files.length, 0);
}));
