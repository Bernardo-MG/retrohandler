import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseHandle, Statement } from '../../src/main/database/sql/types';
import { openTestRepositories } from '../helpers/database';
import { LaunchBoxCatalogueImporter } from '../../src/main/metadata/launchbox/launchbox-catalogue-importer';
import { parseLaunchBoxGame, xmlText } from '../../src/main/metadata/launchbox/launchbox-xml-reader';
import { LibretroProvider } from '../../src/main/metadata/libretro/libretro-provider';
import { LibretroClient } from '../../src/main/metadata/libretro/libretro-client';
import { LibretroTitleMatcher } from '../../src/main/metadata/libretro/libretro-title-matcher';
import { libretroPlatform } from '../../src/main/metadata/libretro/libretro-platforms';
import { LibretroCatalogue, parseLibretroIndex } from '../../src/main/metadata/libretro/libretro-catalogue';
import { MetadataService } from '../../src/main/metadata';
import { LaunchBoxProvider } from '../../src/main/metadata/launchbox/launchbox-provider';
import { HttpClient } from '../../src/main/components/http/http-client';
import { createTestImageCache } from '../helpers/image-cache';

function createProvider(root: string, request: typeof fetch): LibretroProvider {
  return new LibretroProvider(createTestImageCache(root), new LibretroClient(new HttpClient(request)));
}

function adapter(file: string): DatabaseHandle {
  const db = new DatabaseSync(file);
  return {
    pragma: (sql) => db.exec(`PRAGMA ${sql}`),
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql) as Statement,
    transaction: (fn) => () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close()
  };
}
const sample = (id: number, name: string, platform = 'Nintendo Entertainment System') =>
  `<Game><DatabaseID>${id}</DatabaseID><Name>${name}</Name><Platform>${platform}</Platform><ReleaseDate>1992-03-01T00:00:00</ReleaseDate><Overview>Good &amp; old</Overview><Developer>Studio</Developer><Publisher>Publisher</Publisher><Genre>Action</Genre></Game>`;

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8FZgAAAABJRU5ErkJggg==',
  'base64'
);

test('LaunchBox parses escaped game text and rejects missing platform', () => {
  assert.equal(xmlText('A &amp; B &#65; &lt;Test&gt;'), 'A & B A <Test>');
  const value = parseLaunchBoxGame(sample(17, 'Sonic &amp; Knuckles'));
  assert.equal(value?.title, 'Sonic & Knuckles');
  assert.equal(value?.released, '1992-03-01');
  assert.equal(value?.description, 'Good & old');
  assert.equal(parseLaunchBoxGame('<Game><DatabaseID>2</DatabaseID><Name>Empty</Name></Game>'), null);
});

test('LaunchBox import is searchable offline, persists and protects existing metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rh-launchbox-'));
  try {
    const file = path.join(dir, 'Metadata.xml');
    await writeFile(
      file,
      '<LaunchBox>' +
        sample(17, 'A &amp; B') +
        sample(18, 'A &amp; Better', 'Super Nintendo Entertainment System') +
        '</LaunchBox>'
    );
    const dbfile = path.join(dir, 'library.sqlite');
    const store = openTestRepositories(dbfile, adapter);
    store.collections.saveScan({
      source: '/games',
      scannedAt: '2026-01-01',
      ignored: 0,
      games: [
        {
          id: '1',
          name: 'Local game',
          system: 'Nintendo Entertainment System',
          relativePath: 'a.nes',
          extension: '.nes',
          bytes: 1
        }
      ]
    });
    store.metadata.saveMetadata('/games', 'a.nes', {
      title: 'Manual title',
      description: 'Custom',
      released: '1991',
      developer: '',
      publisher: '',
      genre: '',
      provider: 'manual',
      providerId: null,
      providerSlug: null,
      artworkId: null,
      systemOverride: 'Super Nintendo'
    });
    assert.equal(await new LaunchBoxCatalogueImporter(store.launchBox).importFile(file), 2);
    assert.equal(store.launchBox.searchLaunchBox('A & B', 'Nintendo Entertainment System')[0].id, 17);
    assert.equal(store.launchBox.getLaunchBoxGame(17)?.description, 'Good & old');
    assert.equal(
      store.roms.queryLibrary({
        source: '/games',
        search: '',
        system: null,
        sort: 'name',
        descending: false,
        offset: 0,
        limit: 10
      }).items[0].metadata?.title,
      'Manual title'
    );
    store.database.close();
    const reopened = openTestRepositories(dbfile, adapter);
    assert.equal(reopened.launchBox.searchLaunchBox('A &', 'Super Nintendo Entertainment System').length, 2);
    reopened.database.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed import never replaces an existing LaunchBox catalogue', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rh-launchbox-'));
  try {
    const file = path.join(dir, 'catalogue.xml'),
      store = openTestRepositories(path.join(dir, 'library.sqlite'), adapter);
    await writeFile(file, sample(1, 'Existing'));
    assert.equal(await new LaunchBoxCatalogueImporter(store.launchBox).importFile(file), 1);
    await writeFile(file, '<!DOCTYPE foo [<!ENTITY x "bad">]>' + sample(2, 'New'));
    await assert.rejects(new LaunchBoxCatalogueImporter(store.launchBox).importFile(file), /entities/);
    assert.equal(store.launchBox.getLaunchBoxGame(1)?.title, 'Existing');
    assert.equal(store.launchBox.getLaunchBoxGame(2), null);
    store.database.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Libretro cover is platform-restricted, cached, and returns null on 404', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rh-libretro-'));
  try {
    const urls: string[] = [];
    const mocked: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const id = await createProvider(dir, mocked).findCover({
      system: 'Nintendo Entertainment System',
      names: ['A & B (USA).zip']
    });
    assert.match(id ?? '', /^[a-f0-9]{64}\.png$/);
    assert.ok(
      urls[0].startsWith(
        'https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%20Entertainment%20System/Named_Boxarts/'
      )
    );
    assert.ok(urls[0].includes('A%20_%20B'));
    assert.equal((await createTestImageCache(dir).read(id!)).mime, 'image/png');
    assert.equal(new LibretroTitleMatcher().candidates(['Game (USA).zip'])[0], 'Game (USA)');
    assert.ok(new LibretroTitleMatcher().candidates(['Game (USA).zip']).includes('Game'));
    await assert.rejects(
      createProvider(dir, mocked).findCover({ system: 'Unmapped System', names: ['Game'] }),
      /No Libretro/
    );
    const missing = await createProvider(dir, async () => new Response(null, { status: 404 })).findCover({
      system: 'Super Nintendo',
      names: ['Missing']
    });
    assert.equal(missing, null);
    await assert.rejects(
      createProvider(dir, async () => new Response('not an image')).findCover({
        system: 'Super Nintendo',
        names: ['Bad']
      }),
      /supported image/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Libretro accepts common system names and preserves exact regional game matches', async () => {
  assert.equal(libretroPlatform('SNES'), 'Nintendo - Super Nintendo Entertainment System');
  assert.equal(libretroPlatform('nes'), 'Nintendo - Nintendo Entertainment System');
  assert.equal(
    libretroPlatform('Super Nintendo Entertainment System'),
    'Nintendo - Super Nintendo Entertainment System'
  );
  assert.equal(libretroPlatform('Sega Genesis'), 'Sega - Mega Drive - Genesis');
  assert.equal(libretroPlatform('Needs identification'), null);
  const candidates = new LibretroTitleMatcher().candidates(['Alien 3 (Europe).zip', 'Alien 3']);
  assert.equal(candidates[0], 'Alien 3 (Europe)');
  assert.ok(candidates.includes('Alien 3 (USA, Europe)'));
  assert.ok(candidates.includes('Alien 3 (USA)'));
  assert.ok(candidates.length <= 24);
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-libretro-alias-'));
  try {
    const requested: string[] = [];
    const request: typeof fetch = async (url) => {
      requested.push(String(url));
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const cover = await createProvider(root, request).findCover({
      system: 'SNES',
      names: ['Alien 3 (Europe).zip']
    });
    assert.ok(cover);
    assert.match(requested[0], /Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/);
    assert.match(requested[0], /Alien%203%20\(Europe\)\.png/);
    assert.equal(requested.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Libretro retries region-qualified filename variants after exact 404', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-libretro-regions-'));
  try {
    const urls: string[] = [];
    const request: typeof fetch = async (url) => {
      const value = String(url);
      urls.push(value);
      return value.includes('Alien%203%20(USA%2C%20Europe).png')
        ? new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
        : new Response(null, { status: 404 });
    };
    const found = await createProvider(root, request).findCover({
      system: 'Game Boy',
      names: ['Alien 3 (Europe).zip']
    });
    assert.ok(found);
    assert.ok(urls[0].includes('Alien%203%20(Europe).png'));
    assert.ok(urls.some((url) => url.includes('Alien%203%20(USA%2C%20Europe).png')));
    assert.ok(urls.length <= 24);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Patch 008.5: catalogue-based manual cover choice, without inventing filenames.
test('Libretro catalogue finds alternate Alien 3 NES naming and ignores unrelated sequels', async () => {
  const files = parseLibretroIndex(
    'Alien 3 (1993)(LJN)(EU).png\nAlien 3 (USA).png\nAlien 2 (USA).png\nAlien 3D (USA).png\n'
  );
  assert.deepEqual(
    new LibretroTitleMatcher().match(files, { title: 'Alien 3', regionHint: 'Alien 3 (Europe).zip' }),
    ['Alien 3 (1993)(LJN)(EU).png', 'Alien 3 (USA).png']
  );
  assert.deepEqual(
    parseLibretroIndex('<a href="Alien%203%20%28Europe%29.png">art</a><a href="../bad.png">bad</a>'),
    ['Alien 3 (Europe).png']
  );
});

test('Libretro search returns cached image previews and skips unavailable catalogue entries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rh-libretro-search-'));
  try {
    const urls: string[] = [];
    const request: typeof fetch = async (url) => {
      const raw = String(url);
      urls.push(raw);
      if (raw.endsWith('/.index'))
        return new Response('Alien 3 (Europe).png\nAlien 3 (1993)(LJN)(EU).png\nOther game.png\n');
      if (raw.includes('Alien%203%20(Europe)')) return new Response(null, { status: 404 });
      if (raw.includes('Alien%203%20%28Europe%29')) return new Response(null, { status: 404 });
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const covers = await createProvider(dir, request).searchCovers({
      system: 'NES',
      query: 'Alien 3',
      regionHint: 'Alien 3 (Europe).zip',
      refresh: true
    });
    assert.equal(covers.length, 1);
    assert.equal(covers[0].title, 'Alien 3 (1993)(LJN)(EU)');
    assert.equal((await createTestImageCache(dir).read(covers[0].artworkId)).mime, 'image/png');
    // The primary thumbnail host and official GitHub mirror are both allowed.
    const primary =
      'https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%20Entertainment%20System/Named_Boxarts/';
    const mirror =
      'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System/master/Named_Boxarts/';
    const missing = encodeURIComponent('Alien 3 (Europe).png');
    const available = encodeURIComponent('Alien 3 (1993)(LJN)(EU).png');
    assert.equal(urls[0], primary + '.index');
    assert.deepEqual(urls.slice(1).sort(), [primary + missing, mirror + missing, primary + available].sort());
    assert.ok(urls.indexOf(primary + missing) < urls.indexOf(mirror + missing));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Libretro cover search skips invalid images but reports cache storage failures', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rh-libretro-cache-'));
  try {
    const query = { system: 'NES', query: 'Game', regionHint: 'Game (USA)', refresh: true };
    const catalogue = 'Game (USA).png\n';
    const invalid: typeof fetch = async (url) =>
      String(url).endsWith('/.index') ? new Response(catalogue) : new Response('invalid image');
    assert.deepEqual(await createProvider(dir, invalid).searchCovers(query), []);

    const failure = new Error('Cache write failed.');
    const request: typeof fetch = async (url) =>
      String(url).endsWith('/.index') ? new Response(catalogue) : new Response(png);
    const provider = new LibretroProvider(
      {
        maxImageBytes: 1024,
        store: async () => {
          throw failure;
        }
      },
      new LibretroClient(new HttpClient(request))
    );
    await assert.rejects(provider.searchCovers(query), (error) => error === failure);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PS2 aliases resolve to PlayStation 2 and inherited object keys are not platform names', () => {
  assert.equal(libretroPlatform('ps2'), 'Sony - PlayStation 2');
  assert.equal(libretroPlatform('PlayStation 2'), 'Sony - PlayStation 2');
  assert.equal(libretroPlatform('constructor'), null);
});

test('Libretro catalogue instances isolate injected clients, support refresh and expire after one hour', async () => {
  let firstRequests = 0;
  let secondRequests = 0;
  let now = 0;
  const first = new LibretroCatalogue(
    new LibretroClient(
      new HttpClient(async () => {
        firstRequests++;
        return new Response('First Game.png\n');
      })
    ),
    () => now
  );
  const second = new LibretroCatalogue(
    new LibretroClient(
      new HttpClient(async () => {
        secondRequests++;
        return new Response('Second Game.png\n');
      })
    ),
    () => now
  );
  const platform = 'Nintendo - Nintendo Entertainment System';
  assert.deepEqual(await first.getFiles(platform), ['First Game.png']);
  assert.deepEqual(await second.getFiles(platform), ['Second Game.png']);
  assert.deepEqual(await first.getFiles(platform), ['First Game.png']);
  assert.equal(firstRequests, 1);
  assert.equal(secondRequests, 1);
  await first.getFiles(platform, true);
  assert.equal(firstRequests, 2);
  now = 60 * 60 * 1000;
  await first.getFiles(platform);
  assert.equal(firstRequests, 3);
});

test('Libretro uses the official GitHub tree fallback when both index endpoints fail', async () => {
  const requests: string[] = [];
  const sha = 'a'.repeat(40);
  const client = new LibretroClient(
    new HttpClient(async (url) => {
      const address = String(url);
      requests.push(address);
      if (address.endsWith('/git/trees/master')) {
        return new Response(JSON.stringify({ tree: [{ path: 'Named_Boxarts', type: 'tree', sha }] }));
      }
      if (address.endsWith(`/git/trees/${sha}`)) {
        return new Response(
          JSON.stringify({
            tree: [{ path: 'Game.png', type: 'blob' }, { path: '../bad.png', type: 'blob' }, null]
          })
        );
      }
      return new Response(null, { status: 404 });
    })
  );
  const catalogue = new LibretroCatalogue(client);
  assert.deepEqual(await catalogue.getFiles('Nintendo - Game Boy'), ['Game.png']);
  assert.equal(requests.length, 4);
  assert.ok(requests[0].endsWith('/Named_Boxarts/.index'));
  assert.ok(requests[1].endsWith('/Named_Boxarts/'));
  assert.ok(requests[2].startsWith('https://api.github.com/repos/libretro-thumbnails/'));
});

test('metadata service applies a LaunchBox candidate while retaining artwork and the system override', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-metadata-service-'));
  const repositories = openTestRepositories(path.join(root, 'library.sqlite'), adapter);
  try {
    repositories.collections.saveScan({
      source: '/games',
      scannedAt: '2026-01-01',
      ignored: 0,
      games: [{ id: '1', name: 'Local', system: 'NES', relativePath: 'a.nes', extension: '.nes', bytes: 1 }]
    });
    const artworkId = 'a'.repeat(64) + '.png';
    repositories.metadata.saveMetadata('/games', 'a.nes', {
      title: 'Manual',
      description: '',
      released: '',
      developer: '',
      publisher: '',
      genre: '',
      provider: 'manual',
      providerId: null,
      providerSlug: null,
      artworkId,
      systemOverride: 'Super Nintendo'
    });
    const filename = path.join(root, 'Metadata.xml');
    await writeFile(filename, sample(17, 'Imported title'));
    await new LaunchBoxCatalogueImporter(repositories.launchBox).importFile(filename);
    const service = new MetadataService(repositories.metadata, new LaunchBoxProvider(repositories.launchBox));
    assert.equal(service.search({ query: 'Imported', system: 'NES' })[0].id, 17);
    const target = { source: '/games', relativePath: 'a.nes' };
    const applied = service.applyCandidate(target, 17);
    assert.equal(applied.title, 'Imported title');
    assert.equal(applied.provider, 'launchbox');
    assert.equal(applied.providerId, '17');
    assert.equal(applied.artworkId, artworkId);
    assert.equal(applied.systemOverride, 'Super Nintendo');
    assert.throws(() => service.applyCandidate(target, 999), /not found/);
  } finally {
    repositories.database.close();
    await rm(root, { recursive: true, force: true });
  }
});
