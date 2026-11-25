import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultSettings } from '../src/shared';
import { SettingsStore, validateSettings, validateSettingsPatch } from '../src/main/settings/settings-store';
import { restoreWindowBounds } from '../src/main/settings/window-bounds';
import { cleanupArtworkCache, inspectArtworkCache } from '../src/main/settings/artwork-cache';

function fixture(run: (root: string, file: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'retrohandler-settings-'));
  try {
    run(root, path.join(root, 'settings.json'));
  }
  finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  'a missing settings file starts with independent defaults',
  () => fixture((_root, file) => {
    const store = new SettingsStore(file);
    assert.deepEqual(store.snapshot(), { settings: defaultSettings(), warning: null });
    const copy = store.snapshot().settings;
    copy.export.overrides.NES = 'wrong';
    copy.appearance.theme = 'light';
    assert.deepEqual(store.snapshot().settings, defaultSettings());
    assert.equal(existsSync(file), false);
  })
);

test(
  'library, export, metadata, appearance and window preferences survive a new store',
  () => fixture((root, file) => {
    const store = new SettingsStore(file);
    const library = {
      ...defaultSettings().library,
      selected: path.join(root, 'roms'),
      search: 'Mario',
      system: 'NES',
      sort: 'bytes' as const,
      descending: true,
      identification: 'verified' as const,
      view: 'grid' as const
    };
    const exportOptions = {
      destination: path.join(root, 'retropie'),
      includeArtwork: false,
      overrides: { NES: 'nes', SNES: 'snes' }
    };
    store.update({
      library,
      export: exportOptions,
      appearance: { theme: 'system' },
      metadata: { startWith: 'launchbox', artwork: 'saved-only' }
    });
    const window = {
      bounds: {
        x: -1200,
        y: 40,
        width: 1200,
        height: 800
      }, maximized: true
    };
    store.saveWindow(window);
    const restored = new SettingsStore(file).snapshot().settings;
    assert.deepEqual(
      restored,
      {
        version: 1,
        library,
        export: exportOptions,
        appearance: { theme: 'system' },
        metadata: { startWith: 'launchbox', artwork: 'saved-only' },
        window
      }
    );
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), restored);
    assert.deepEqual(readdirSync(root), ['settings.json']);
  })
);

test(
  'section updates preserve all unrelated preferences',
  () => fixture((root, file) => {
    const store = new SettingsStore(file);
    store.update({ library: { ...defaultSettings().library, view: 'grid' } });
    store.update({ export: { ...defaultSettings().export, destination: path.join(root, 'export') } });
    store.saveWindow({
      bounds: {
        x: 5,
        y: 10,
        width: 1000,
        height: 700
      }, maximized: true
    });
    store.update({ appearance: { theme: 'light' } });
    const saved = new SettingsStore(file).snapshot().settings;
    assert.equal(saved.library.view, 'grid');
    assert.equal(saved.export.destination, path.join(root, 'export'));
    assert.equal(saved.window.maximized, true);
    assert.equal(saved.appearance.theme, 'light');
  })
);

test(
  'invalid settings patches are rejected before touching the current file',
  () => fixture((_root, file) => {
    const store = new SettingsStore(file);
    store.update({ appearance: { theme: 'light' } });
    const previous = readFileSync(file);
    const invalid: unknown[] = [
      null,
      [],
      {},
      { version: 2 },
      { window: { bounds: null, maximized: false } },
      { appearance: { theme: 'blue' } },
      { appearance: { theme: 'dark', unexpected: true } },
      { library: { ...defaultSettings().library, sort: 'wrong' } },
      { library: { ...defaultSettings().library, search: 'a'.repeat(257) } },
      { library: { ...defaultSettings().library, selected: '../roms' } },
      { library: { ...defaultSettings().library, identification: 'made-up' } },
      { export: { ...defaultSettings().export, destination: '../outside' } },
      { export: { ...defaultSettings().export, overrides: { NES: '../outside' } } },
      { export: { ...defaultSettings().export, overrides: { NES: 'nul' } } },
      { export: { ...defaultSettings().export, overrides: JSON.parse('{"__proto__":"nes"}') } },
      { metadata: { startWith: 'unknown-provider', artwork: 'libretro' } }
    ];
    for (const candidate of invalid) {
      assert.throws(() => store.update(candidate), /Invalid application settings/);
    }
    assert.throws(
      () => store.saveWindow({
        bounds: {
          x: 0,
          y: 0,
          width: 0,
          height: 600
        }, maximized: false
      }),
      /Invalid/
    );
    assert.deepEqual(readFileSync(file), previous);
    assert.equal(store.snapshot().settings.appearance.theme, 'light');
  })
);

test(
  'full settings validation rejects unsupported schemas and unknown fields',
  () => {
    assert.deepEqual(validateSettings(defaultSettings()), defaultSettings());
    assert.throws(() => validateSettings({ ...defaultSettings(), version: 0 }), /Unsupported/);
    assert.throws(() => validateSettings({ ...defaultSettings(), unexpected: true }), /Invalid/);
    assert.deepEqual(
      validateSettingsPatch({ export: { ...defaultSettings().export, overrides: { NES: 'nes' } } }),
      { export: { ...defaultSettings().export, overrides: { NES: 'nes' } } }
    );
  }
);

test(
  'a corrupt settings file is backed up byte for byte before recovery',
  () => fixture((root, file) => {
    const bad = '{invalid json';
    writeFileSync(file, bad);
    const store = new SettingsStore(file);
    assert.deepEqual(store.snapshot().settings, defaultSettings());
    assert.match(store.snapshot().warning ?? '', /backed up/);
    const backup = readdirSync(root).find(name => name.startsWith('settings.json.corrupt-'));
    assert.ok(backup);
    assert.equal(readFileSync(path.join(root, backup), 'utf8'), bad);
    store.update({ appearance: { theme: 'light' } });
    assert.equal(new SettingsStore(file).snapshot().settings.appearance.theme, 'light');
    assert.equal(readFileSync(path.join(root, backup), 'utf8'), bad);
  })
);

test(
  'a syntactically valid file with invalid values also recovers safely',
  () => fixture((root, file) => {
    writeFileSync(file, JSON.stringify({ ...defaultSettings(), appearance: { theme: 'invalid' } }));
    const store = new SettingsStore(file);
    assert.equal(store.snapshot().settings.appearance.theme, 'dark');
    assert.ok(readdirSync(root).some(name => name.startsWith('settings.json.corrupt-')));
  })
);

test(
  'a newer settings schema is not renamed, reset or overwritten',
  () => fixture((root, file) => {
    const future = JSON.stringify({ version: 2, futurePreference: 'retain' });
    writeFileSync(file, future);
    const store = new SettingsStore(file);
    assert.match(store.snapshot().warning ?? '', /newer RetroHandler/);
    assert.throws(() => store.reset(), /newer RetroHandler/);
    assert.throws(() => store.update({ appearance: { theme: 'light' } }), /newer RetroHandler/);
    assert.equal(readFileSync(file, 'utf8'), future);
    assert.deepEqual(readdirSync(root), ['settings.json']);
  })
);

test(
  'failed writes do not change the in-memory settings or leave temporary files',
  () => fixture((root, file) => {
    const store = new SettingsStore(file);
    store.update({ appearance: { theme: 'light' } });
    rmSync(file);
    mkdirSync(file); // A replacement directory must not be overwritten or removed.
    assert.throws(() => store.update({ appearance: { theme: 'system' } }), /regular file/);
    assert.equal(store.snapshot().settings.appearance.theme, 'light');
    assert.deepEqual(readdirSync(root), ['settings.json']);
  })
);

test(
  'settings reset does not delete the database, ROMs or artwork',
  () => fixture((root, file) => {
    const database = path.join(root, 'library.sqlite');
    const artwork = path.join(root, 'artwork');
    const rom = path.join(root, 'game.zip');
    mkdirSync(artwork);
    writeFileSync(database, 'library');
    writeFileSync(rom, 'rom');
    writeFileSync(path.join(artwork, 'cover.png'), 'cover');
    const store = new SettingsStore(file);
    store.update({ appearance: { theme: 'system' }, export: { ...defaultSettings().export, destination: root } });
    store.saveWindow({
      bounds: {
        x: 5,
        y: 5,
        width: 1000,
        height: 700
      }, maximized: true
    });
    assert.deepEqual(store.reset(), defaultSettings());
    assert.deepEqual(new SettingsStore(file).snapshot().settings, defaultSettings());
    assert.equal(readFileSync(database, 'utf8'), 'library');
    assert.equal(readFileSync(rom, 'utf8'), 'rom');
    assert.equal(readFileSync(path.join(artwork, 'cover.png'), 'utf8'), 'cover');
  })
);

test(
  'symlinked settings files are never read or overwritten',
  { skip: process.platform === 'win32' },
  () => fixture((root, file) => {
    const external = path.join(root, 'external.json');
    writeFileSync(external, JSON.stringify(defaultSettings()));
    symlinkSync(external, file);
    const store = new SettingsStore(file);
    assert.match(store.snapshot().warning ?? '', /not a regular file/);
    assert.throws(() => store.reset(), /disabled/);
    assert.deepEqual(JSON.parse(readFileSync(external, 'utf8')), defaultSettings());
  })
);

const primary = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1040
};
const secondary = {
  x: -1600,
  y: 0,
  width: 1600,
  height: 900
};

test(
  'window restoration preserves bounds on an attached secondary monitor',
  () => {
    const saved = {
      x: -1500,
      y: 40,
      width: 1200,
      height: 800
    };
    assert.deepEqual(restoreWindowBounds(saved, [primary, secondary], primary), saved);
  }
);

test(
  'window restoration clamps an off-screen or oversized window to an available display',
  () => {
    assert.deepEqual(
      restoreWindowBounds({
        x: -1600,
        y: 0,
        width: 1200,
        height: 800
      }, [primary], primary),
      {
        x: 360,
        y: 120,
        width: 1200,
        height: 800
      }
    );
    assert.deepEqual(
      restoreWindowBounds({
        x: 1800,
        y: 950,
        width: 2600,
        height: 1200
      }, [primary], primary),
      primary
    );
    const small = {
      x: 10,
      y: 10,
      width: 800,
      height: 500
    };
    assert.deepEqual(restoreWindowBounds(null, [small], small), small);
    assert.deepEqual(restoreWindowBounds(null, [primary], primary), {
      x: 320,
      y: 110,
      width: 1280,
      height: 820
    });
  }
);

const DAY = 86400000;
const NOW = Date.now();
const asset = (letter: string) => `${letter.repeat(64)}.png`;
function agedFile(root: string, name: string, ageDays: number, contents: string) {
  const file = path.join(root, name);
  writeFileSync(file, contents);
  const date = new Date(NOW - ageDays * DAY);
  utimesSync(file, date, date);
  return file;
}

test(
  'cache accounting and cleanup retain referenced artwork, new artwork and unrelated files',
  () => fixture((root) => {
    const cache = path.join(root, 'artwork');
    mkdirSync(cache);
    const referenced = agedFile(cache, asset('a'), 10, 'keep');
    const unused = agedFile(cache, asset('b'), 8, 'delete');
    const recent = agedFile(cache, asset('c'), 2, 'recent');
    const staleDownload = agedFile(cache, '.download-12345678-1234-1234-1234-123456789abc', 2, 'partial');
    const freshDownload = agedFile(cache, '.download-12345678-1234-1234-1234-123456789def', 0, 'new');
    const unrelated = agedFile(cache, 'notes.txt', 100, 'notes');
    const refs = new Set([asset('a')]);
    const info = inspectArtworkCache(cache, refs, NOW);
    assert.deepEqual(info, {
      artworkFiles: 5,
      artworkBytes: 26,
      reclaimableFiles: 2,
      reclaimableBytes: 13
    });
    assert.deepEqual(cleanupArtworkCache(cache, refs, NOW), { removedFiles: 2, removedBytes: 13, failedFiles: 0 });
    for (const file of [referenced, recent, freshDownload, unrelated]) {
      assert.ok(existsSync(file));
    }
    for (const file of [unused, staleDownload]) {
      assert.equal(existsSync(file), false);
    }
    assert.equal(inspectArtworkCache(cache, refs, NOW).reclaimableFiles, 0);
  })
);

test(
  'cache cleanup re-evaluates newly referenced artwork',
  () => fixture(root => {
    const cache = path.join(root, 'artwork');
    mkdirSync(cache);
    const file = agedFile(cache, asset('d'), 10, 'newly referenced');
    assert.equal(inspectArtworkCache(cache, new Set(), NOW).reclaimableFiles, 1);
    assert.equal(cleanupArtworkCache(cache, new Set([asset('d')]), NOW).removedFiles, 0);
    assert.ok(existsSync(file));
  })
);

test(
  'cache cleanup does not create a missing cache or recurse into directories',
  () => fixture(root => {
    const cache = path.join(root, 'missing');
    assert.deepEqual(
      inspectArtworkCache(cache, new Set(), NOW),
      {
        artworkFiles: 0,
        artworkBytes: 0,
        reclaimableFiles: 0,
        reclaimableBytes: 0
      }
    );
    assert.equal(cleanupArtworkCache(cache, new Set(), NOW).removedFiles, 0);
    assert.equal(existsSync(cache), false);
    mkdirSync(cache);
    mkdirSync(path.join(cache, asset('a')));
    const nested = agedFile(path.join(cache, asset('a')), asset('b'), 100, 'retain');
    assert.equal(cleanupArtworkCache(cache, new Set(), NOW).removedFiles, 0);
    assert.ok(existsSync(nested));
  })
);

test(
  'cache cleanup refuses redirected cache directories and skips linked files',
  { skip: process.platform === 'win32' },
  () => fixture(root => {
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    const file = agedFile(outside, asset('e'), 100, 'retain');
    const link = path.join(root, 'link');
    symlinkSync(outside, link, 'dir');
    assert.throws(() => cleanupArtworkCache(link, new Set(), NOW), /regular directory/);
    const cache = path.join(root, 'artwork');
    mkdirSync(cache);
    symlinkSync(file, path.join(cache, asset('e')));
    assert.equal(cleanupArtworkCache(cache, new Set(), NOW).removedFiles, 0);
    assert.equal(readFileSync(file, 'utf8'), 'retain');
  })
);
