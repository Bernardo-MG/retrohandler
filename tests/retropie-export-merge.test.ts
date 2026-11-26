import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { executeExport, previewExport, type ExportLibrary } from '../src/main/export/export';
import { mergeGameLists } from '../src/main/export/retropie/gamelist';
import { cacheArtworkBytes } from '../src/main/metadata/artwork';
import type { ExportOptions, LibraryEntry } from '../src/shared';

const game = (source: string, name = 'Game.zip'): LibraryEntry => ({
  id: name,
  name,
  source,
  relativePath: name,
  system: 'Nintendo Entertainment System',
  extension: '.zip',
  bytes: 4,
  metadata: {
    source,
    relativePath: name,
    title: 'New & <Title>',
    description: 'New description',
    released: '1992',
    developer: '',
    publisher: '',
    genre: '',
    provider: 'manual',
    providerId: null,
    providerSlug: null,
    artworkId: null
  }
});
const library = (items: LibraryEntry[]): ExportLibrary => ({
  queryLibrary: async q => ({ items: items.slice(q.offset, q.offset + q.limit), total: items.length })
});
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<gameList>${body}</gameList>\n`;
const oldGame = (rom = './Game.zip') => `<game id="42"><path>${rom}</path><name>Old name</name><favorite>true</favorite><playcount>8</playcount><lastplayed>20260101T000000</lastplayed><genre>Old genre</genre><image>./images/old.png</image></game>`;
const unrelated = '<game><path>./Other.zip</path><name>Other &amp; game</name><desc><![CDATA[Unrelated <game> & text]]></desc></game>';
const folder = '<folder><path>./extras</path><name>Extras</name></folder>';

async function fixture(fn: (f: {
  root: string;
  source: string;
  destination: string;
  system: string;
  xml: string;
  cache: string;
  entry: LibraryEntry;
  options: ExportOptions
}) => Promise<void>) {
  // Resolve the temp root for platforms where the system temp directory is an alias.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'retrohandler-merge-')));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  const system = path.join(destination, 'roms', 'nes');
  const cache = path.join(root, 'cache');
  await mkdir(source);
  await mkdir(system, { recursive: true });
  await writeFile(path.join(source, 'Game.zip'), 'data');
  try {
    await fn({
      root,
      source,
      destination,
      system,
      xml: path.join(system, 'gamelist.xml'),
      cache,
      entry: game(source),
      options: {
        destination,
        source: null,
        includeArtwork: false,
        overrides: {}
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test(
  'merges matching metadata, preserves unrelated records and old statistics, and backs up exact bytes',
  async () => fixture(async f => {
    const original = Buffer.from('\ufeff' + doc('\n<!-- keep this -->\n' + oldGame() + '\n' + unrelated + folder).replace(/\n/g, '\r\n'));
    await writeFile(f.xml, original);
    await writeFile(path.join(f.system, 'Game.zip'), 'existing ROM');
    await writeFile(path.join(f.source, 'New.zip'), 'data');
    const lib = library([f.entry, game(f.source, 'New.zip')]);
    const plan = await previewExport(lib, f.options, f.cache);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.files.find(x => x.kind === 'gamelist')?.action, 'update');
    assert.equal(plan.skippedRoms, 0);
    assert.deepEqual(await readFile(f.xml), original);
    assert.deepEqual((await readdir(f.system)).sort(), ['Game.zip', 'gamelist.xml']);
    const receipt = await executeExport(lib, f.options, f.cache, plan.fingerprint);
    assert.equal(receipt.copied, 1);
    assert.equal(receipt.backups?.length, 1);
    assert.match(receipt.backups![0], /^roms\/nes\/gamelist\.xml\.retrohandler-[a-f0-9-]+\.bak$/);
    assert.deepEqual(await readFile(path.join(f.destination, receipt.backups![0])), original);
    const merged = await readFile(f.xml, 'utf8');
    assert.ok(merged.startsWith('\ufeff'));
    assert.match(merged, /<game id="42"><path>\.\/Game.zip<\/path><name>New &amp; &lt;Title&gt;<\/name>/);
    assert.match(
      merged,
      /<favorite>true<\/favorite><playcount>8<\/playcount><lastplayed>20260101T000000<\/lastplayed>/
    );
    assert.match(merged, /<genre>Old genre<\/genre><image>\.\/images\/old.png<\/image>/);
    assert.match(merged, /<releasedate>19920101T000000<\/releasedate>/);
    assert.ok(merged.includes(unrelated));
    assert.ok(merged.includes(folder));
    assert.ok(merged.includes('<!-- keep this -->'));
    assert.match(merged, /<path>\.\/New.zip<\/path>/);
    assert.equal((merged.match(/<path>\.\/Game.zip<\/path>/g) ?? []).length, 1);
    assert.equal(await readFile(path.join(f.system, 'Game.zip'), 'utf8'), 'existing ROM');
    await assert.rejects(readFile(path.join(f.system, 'New.zip')));
    assert.equal(await readFile(path.join(f.source, 'Game.zip'), 'utf8'), 'data');
    // An unchanged repeat is a no-op, not another backup or duplicate entry.
    const repeat = await previewExport(lib, f.options, f.cache);
    assert.equal(repeat.files.find(x => x.kind === 'gamelist')?.action, 'reuse');
    assert.deepEqual(await executeExport(lib, f.options, f.cache, repeat.fingerprint), { copied: 0 });
    assert.equal(await readFile(f.xml, 'utf8'), merged);
    assert.equal((await readdir(f.system)).filter(p => p.endsWith('.bak')).length, 1);
  })
);

test(
  'existing scraped title and missing metadata survive when local metadata is empty',
  async () => fixture(async f => {
    f.entry.metadata = null;
    await writeFile(f.xml, doc(oldGame()));
    const plan = await previewExport(library([f.entry]), f.options, f.cache);
    assert.equal(plan.files.find(x => x.kind === 'gamelist')?.action, 'reuse');
    assert.deepEqual(await executeExport(library([f.entry]), f.options, f.cache, plan.fingerprint), { copied: 0 });
    assert.equal(await readFile(f.xml, 'utf8'), doc(oldGame()));
  })
);

test(
  'standard absolute paths and XML entities match without changing the existing path',
  () => {
    const existing = doc(oldGame('/home/pi/RetroPie/roms/nes/A&#38;B.zip'));
    const fresh = doc('<game><path>./A&amp;B.zip</path><name>New name</name></game>');
    const merged = mergeGameLists(existing, fresh, 'nes');
    assert.match(merged, /<path>\/home\/pi\/RetroPie\/roms\/nes\/A&#38;B.zip<\/path><name>New name<\/name>/);
    assert.equal((merged.match(/<game\b/g) ?? []).length, 1);
  }
);

test(
  'supports a self-closing empty gamelist, comments and empty metadata elements',
  () => {
    const fresh = doc('<game><path>./Game.zip</path><name>New</name></game>');
    const filled = mergeGameLists('<?xml version="1.0"?><gameList />\n', fresh, 'nes');
    assert.match(filled, /<gameList >[\s\S]*<path>\.\/Game.zip<\/path>[\s\S]*<\/gameList>/);
    const existing = doc('<!----><game><path>Game.zip</path><name /></game>');
    const merged = mergeGameLists(existing, fresh, 'nes');
    assert.ok(merged.includes('<!---->'));
    assert.match(merged, /<name>New<\/name>/);
  }
);

test(
  'malformed, unsupported and ambiguous existing XML block writes',
  async () => fixture(async f => {
    const bad = [
      '<gameList><game><path>./Game.zip</path></gameList>',
      '<!DOCTYPE gameList [<!ENTITY x SYSTEM "file:///tmp/no">]><gameList/>',
      doc('<game><path>./Game.zip</path><name>bad & value</name></game>'),
      doc('<game><path>./Game.zip</path><desc><nested>data</nested></desc></game>'),
      doc(oldGame() + oldGame('Game.zip')),
      doc(oldGame('./game.zip')),
      doc(oldGame('/custom/roms/Game.zip')),
      doc('<folder><path>./Game.zip</path></folder>'),
      doc('<game><path>./Game.zip</path><name>one</name><name>two</name></game>'),
      '<?xml version="1.0" encoding="ISO-8859-1"?><gameList/>'
    ];
    for (const xml of bad) {
      await writeFile(f.xml, xml);
      const lib = library([f.entry]);
      const plan = await previewExport(lib, f.options, f.cache);
      assert.equal(plan.conflicts.length, 1, xml);
      await assert.rejects(executeExport(lib, f.options, f.cache, plan.fingerprint), /conflicts/);
      assert.equal(await readFile(f.xml, 'utf8'), xml);
      assert.deepEqual(await readdir(f.system), ['gamelist.xml']);
    }
  })
);

test(
  'same-size changes to existing XML invalidate a preview without writing backups',
  async () => fixture(async f => {
    await writeFile(f.xml, doc(oldGame()));
    const lib = library([f.entry]);
    const plan = await previewExport(lib, f.options, f.cache);
    const changed = doc(oldGame().replace('Old name', 'New name'));
    await writeFile(f.xml, changed);
    await assert.rejects(executeExport(lib, f.options, f.cache, plan.fingerprint), /preview changed/);
    assert.equal(await readFile(f.xml, 'utf8'), changed);
    assert.deepEqual(await readdir(f.system), ['gamelist.xml']);
  })
);

test(
  'same-size changes to library metadata invalidate the preview',
  async () => fixture(async f => {
    const lib = library([f.entry]);
    const plan = await previewExport(lib, f.options, f.cache);
    f.entry.metadata!.title = 'Alt & <Title>';
    await assert.rejects(executeExport(lib, f.options, f.cache, plan.fingerprint), /preview changed/);
    assert.deepEqual(await readdir(f.system), []);
  })
);

test(
  'artwork is copied once and subsequent identical images are reused',
  async () => fixture(async f => {
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const id = await cacheArtworkBytes(image, f.cache);
    f.entry.metadata!.artworkId = id;
    f.options.includeArtwork = true;
    const lib = library([f.entry]);
    const plan = await previewExport(lib, f.options, f.cache);
    assert.equal(plan.files.find(x => x.kind === 'artwork')?.action, 'create');
    assert.deepEqual(await executeExport(lib, f.options, f.cache, plan.fingerprint), { copied: 2 });
    const target = path.join(f.system, 'images', id);
    assert.deepEqual(await readFile(target), image);
    assert.ok((await readFile(f.xml, 'utf8')).includes(`<image>./images/${id}</image>`));
    const repeat = await previewExport(lib, f.options, f.cache);
    assert.equal(repeat.files.find(x => x.kind === 'artwork')?.action, 'reuse');
    assert.equal(repeat.files.find(x => x.kind === 'gamelist')?.action, 'reuse');
    assert.equal(repeat.bytes, 0);
    assert.deepEqual(await executeExport(lib, f.options, f.cache, repeat.fingerprint), { copied: 0 });
    // A same-length but different destination file is a conflict, not a reuse.
    const different = Buffer.from(image);
    different[different.length - 1] = 4;
    await writeFile(target, different);
    const conflict = await previewExport(lib, f.options, f.cache);
    assert.ok(conflict.conflicts.some(c => c.includes('Existing artwork differs')));
    await assert.rejects(executeExport(lib, f.options, f.cache, conflict.fingerprint), /conflicts/);
    assert.deepEqual(await readFile(target), different);
  })
);

test(
  'same-length changes to cached artwork invalidate preview',
  async () => fixture(async f => {
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const id = await cacheArtworkBytes(image, f.cache);
    f.entry.metadata!.artworkId = id;
    f.options.includeArtwork = true;
    const lib = library([f.entry]);
    const plan = await previewExport(lib, f.options, f.cache);
    const different = Buffer.from(image);
    different[different.length - 1] = 4;
    await writeFile(path.join(f.cache, id), different);
    await assert.rejects(executeExport(lib, f.options, f.cache, plan.fingerprint), /preview changed/);
    assert.deepEqual(await readdir(f.system), []);
  })
);

test(
  'linked gamelists and redirected system directories are never written',
  {
    skip: process.platform === 'win32' ? 'Windows symlink creation may require developer mode' : false
  },
  async () => fixture(async f => {
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    const external = path.join(outside, 'gamelist.xml');
    await writeFile(external, doc(oldGame()));
    await symlink(external, f.xml);
    const lib = library([f.entry]);
    const linked = await previewExport(lib, f.options, f.cache);
    assert.equal(linked.conflicts.length, 1);
    await assert.rejects(executeExport(lib, f.options, f.cache, linked.fingerprint), /conflicts/);
    await rm(f.xml);
    await rm(f.system, { recursive: true });
    await symlink(outside, f.system, 'dir');
    const redirected = await previewExport(lib, f.options, f.cache);
    assert.equal(redirected.conflicts.length, 1);
    await assert.rejects(executeExport(lib, f.options, f.cache, redirected.fingerprint), /conflicts/);
    assert.equal(await readFile(external, 'utf8'), doc(oldGame()));
    assert.deepEqual(await readdir(outside), ['gamelist.xml']);
  })
);

test(
  'skipped ROMs are counted, rather than treating omitted artwork as a skipped game',
  async () => fixture(async f => {
    f.entry.metadata!.artworkId = 'a'.repeat(64) + '.png';
    f.options.includeArtwork = true;
    const missing = game(f.source, 'Missing.zip');
    const plan = await previewExport(library([f.entry, missing]), f.options, f.cache);
    assert.equal(plan.skippedRoms, 1);
    assert.equal(plan.warnings.length, 2);
    assert.equal(plan.files.filter(x => x.kind === 'rom').length, 1);
    assert.deepEqual(plan.conflicts, []);
  })
);
