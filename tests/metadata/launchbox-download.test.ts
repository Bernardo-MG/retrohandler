import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createRestrictedArchiveReader } from '../../src/main/components/archives';
import { createArchiveFixture } from '../helpers/archive-fixtures';
import { HttpClient } from '../../src/main/components/http/http-client';
import { LaunchBoxCatalogueImporter } from '../../src/main/metadata/launchbox/launchbox-catalogue-importer';
import {
  LaunchBoxCatalogueUpdater,
  LAUNCHBOX_ARCHIVE_URL,
  MAX_LAUNCHBOX_ARCHIVE_BYTES
} from '../../src/main/metadata/launchbox/launchbox-catalogue-updater';
import { MAX_LAUNCHBOX_XML_BYTES } from '../../src/main/metadata/launchbox/launchbox-xml-reader';
import type { LaunchBoxGame, LaunchBoxImportRepository } from '../../src/main/contracts/persistence';

const sample =
  '<LaunchBox><Game><DatabaseID>31</DatabaseID><Name>Retro Test</Name><Platform>Nintendo Entertainment System</Platform></Game></LaunchBox>';
function fakeStore() {
  let current = [{ id: 5, title: 'Original' }] as Array<Partial<LaunchBoxGame>>;
  let staging: Array<Partial<LaunchBoxGame>> = [];
  let abandoned = 0;
  const store: LaunchBoxImportRepository = {
    beginLaunchBoxImport() {
      staging = [];
    },
    addLaunchBoxGame(game: LaunchBoxGame) {
      staging.push(game);
    },
    finishLaunchBoxImport() {
      current = staging;
      staging = [];
      return current.length;
    },
    abortLaunchBoxImport() {
      staging = [];
      abandoned++;
    }
  };
  return { store, games: () => current, aborted: () => abandoned };
}
function createUpdater(store: LaunchBoxImportRepository, request: typeof fetch): LaunchBoxCatalogueUpdater {
  const archive = createRestrictedArchiveReader({
    maxArchiveBytes: MAX_LAUNCHBOX_ARCHIVE_BYTES,
    maxEntryBytes: MAX_LAUNCHBOX_XML_BYTES
  });
  return new LaunchBoxCatalogueUpdater(new LaunchBoxCatalogueImporter(store), archive, new HttpClient(request));
}
const response = (bytes: Buffer) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Length': String(bytes.length) } });

test('downloads fixed official URL, extracts the archive and commits the parsed catalogue', async () => {
  const db = fakeStore();
  const events: string[] = [];
  const updater = createUpdater(db.store, async (url) => {
    assert.equal(String(url), LAUNCHBOX_ARCHIVE_URL);
    return response(createArchiveFixture(sample, 'Metadata.xml'));
  });
  const count = await updater.download({
    onProgress: (update) => events.push(update.phase)
  });
  assert.equal(count, 1);
  assert.equal(db.games()[0]?.title, 'Retro Test');
  assert.ok(events.includes('download') && events.includes('extract') && events.includes('import'));
});

test('Archive extraction rejects corrupted contents and keeps existing catalogue untouched', async () => {
  const db = fakeStore();
  const bytes = createArchiveFixture(sample, 'Metadata.xml', { centralChecksum: 12345 });
  await assert.rejects(createUpdater(db.store, async () => response(bytes)).download(), /integrity/);
  assert.equal(db.games()[0]?.title, 'Original');
});

test('missing Metadata.xml is rejected without replacing the catalogue', async () => {
  const db = fakeStore();
  await assert.rejects(
    createUpdater(db.store, async () => response(createArchiveFixture(sample, 'Other.xml'))).download(),
    /Metadata.xml/
  );
  assert.equal(db.games()[0]?.title, 'Original');
});

test('aborted download preserves old metadata', async () => {
  const db = fakeStore();
  const controller = new AbortController();
  await assert.rejects(
    createUpdater(db.store, async () => response(createArchiveFixture(sample, 'Metadata.xml'))).download({
      signal: controller.signal,
      onProgress: (update) => {
        if (update.phase === 'download') controller.abort();
      }
    })
  );
  assert.equal(db.games()[0]?.title, 'Original');
});

test('aborted XML import rolls back staging without discarding the old catalogue', async () => {
  const db = fakeStore();
  const controller = new AbortController();
  await assert.rejects(
    createUpdater(db.store, async () => response(createArchiveFixture(sample, 'Metadata.xml'))).download({
      signal: controller.signal,
      onProgress: (update) => {
        if (update.phase === 'import') controller.abort();
      }
    })
  );
  assert.equal(db.games()[0]?.title, 'Original');
  assert.equal(db.aborted(), 1);
});

test('LaunchBox accepts a single Metadata.xml inside an archive directory', async () => {
  const db = fakeStore();
  const updater = createUpdater(db.store, async () => response(createArchiveFixture(sample, 'folder/Metadata.xml')));
  assert.equal(await updater.download(), 1);
  assert.equal(db.games()[0]?.title, 'Retro Test');
});

test('LaunchBox rejects unsafe redirects before requesting the redirected URL', async () => {
  const db = fakeStore();
  const requests: string[] = [];
  const updater = createUpdater(db.store, async (url, options) => {
    requests.push(String(url));
    assert.equal(options?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/Metadata.zip' } });
  });
  await assert.rejects(updater.download(), /Unsafe LaunchBox download redirect/);
  assert.deepEqual(requests, [LAUNCHBOX_ARCHIVE_URL]);
  assert.equal(db.games()[0]?.title, 'Original');
  assert.equal(updater.isUpdating, false);
});

test('LaunchBox accepts a bounded official HTTPS redirect', async () => {
  const db = fakeStore();
  const requests: string[] = [];
  const updater = createUpdater(db.store, async (url) => {
    requests.push(String(url));
    if (requests.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/archives/Metadata.zip' } });
    }
    return response(createArchiveFixture(sample, 'Metadata.xml'));
  });
  assert.equal(await updater.download(), 1);
  assert.deepEqual(requests, [
    LAUNCHBOX_ARCHIVE_URL,
    'https://gamesdb.launchbox-app.com/archives/Metadata.zip'
  ]);
});

test('manual and downloaded catalogue updates share an exclusive lock and release it after failure', async () => {
  const db = fakeStore();
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-update-lock-'));
  try {
    const filename = path.join(root, 'Metadata.xml');
    await writeFile(filename, sample);
    const updater = createUpdater(db.store, async () => new Response(null, { status: 503 }));
    const first = updater.download();
    assert.equal(updater.isUpdating, true);
    await assert.rejects(updater.importFile(filename), /already running/);
    await assert.rejects(updater.download(), /already running/);
    await assert.rejects(first, /HTTP 503/);
    assert.equal(updater.isUpdating, false);
    assert.equal(await updater.importFile(filename), 1);
    assert.equal(updater.isUpdating, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('LaunchBox rejects entity declarations split across stream chunks and rolls back staging', async () => {
  const db = fakeStore();
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-xml-chunks-'));
  try {
    const filename = path.join(root, 'Metadata.xml');
    const prefix = sample.padEnd(64 * 1024 - 3, ' ');
    await writeFile(filename, prefix + '<!DOCTYPE foo [<!ENTITY x "bad">]>' + sample);
    await assert.rejects(new LaunchBoxCatalogueImporter(db.store).importFile(filename), /entities/);
    assert.equal(db.games()[0]?.title, 'Original');
    assert.equal(db.aborted(), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('LaunchBox rejects inconsistent archive entry names without replacing the catalogue', async () => {
  const db = fakeStore();
  const bytes = createArchiveFixture(sample, 'Metadata.xml', { localName: 'Xetadata.xml' });
  await assert.rejects(createUpdater(db.store, async () => response(bytes)).download(), /header mismatch/);
  assert.equal(db.games()[0]?.title, 'Original');
});
