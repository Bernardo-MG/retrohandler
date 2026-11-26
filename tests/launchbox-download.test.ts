import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { ZipArchiveReader } from '../src/main/components/archives/zip-archive-reader';
import { HttpClient } from '../src/main/components/http/http-client';
import { LaunchBoxCatalogueImporter } from '../src/main/metadata/launchbox/launchbox-catalogue-importer';
import { LaunchBoxCatalogueUpdater, LAUNCHBOX_ARCHIVE_URL } from '../src/main/metadata/launchbox/launchbox-catalogue-updater';
import type { LaunchBoxGame, LaunchBoxImportRepository } from '../src/main/contracts/persistence';

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(content: string, name = 'Metadata.xml'): Buffer {
  const nameBytes = Buffer.from(name);
  const xml = Buffer.from(content);
  const deflated = deflateRawSync(xml);
  const crc = crc32(xml);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const directoryOffset = local.length + nameBytes.length + deflated.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12); end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, nameBytes, deflated, central, nameBytes, end]);
}
const sample = '<LaunchBox><Game><DatabaseID>31</DatabaseID><Name>Retro Test</Name><Platform>Nintendo Entertainment System</Platform></Game></LaunchBox>';
function fakeStore() {
  let current = [{ id: 5, title: 'Original' }] as Array<Partial<LaunchBoxGame>>;
  let staging: Array<Partial<LaunchBoxGame>> = [];
  let abandoned = 0;
  const store: LaunchBoxImportRepository = {
    beginLaunchBoxImport() { staging = []; },
    addLaunchBoxGame(game: LaunchBoxGame) { staging.push(game); },
    finishLaunchBoxImport() { current = staging; staging = []; return current.length; },
    abortLaunchBoxImport() { staging = []; abandoned++; }
  };
  return { store, games: () => current, aborted: () => abandoned };
}
function createUpdater(store: LaunchBoxImportRepository, request: typeof fetch): LaunchBoxCatalogueUpdater {
  return new LaunchBoxCatalogueUpdater(new LaunchBoxCatalogueImporter(store), new HttpClient(request));
}
function openArchive(filename: string): ZipArchiveReader {
  return new ZipArchiveReader(filename, { maxArchiveBytes: 512 * 1024 * 1024, maxEntryBytes: 750 * 1024 * 1024 });
}
const response = (bytes: Buffer) => new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Length': String(bytes.length) } });

test('downloads fixed official URL, extracts ZIP and commits the parsed catalogue', async () => {
  const db = fakeStore();
  const events: string[] = [];
  const updater = createUpdater(db.store, async url => {
    assert.equal(String(url), LAUNCHBOX_ARCHIVE_URL);
    return response(zip(sample));
  });
  const count = await updater.download({
    onProgress: update => events.push(update.phase)
  });
  assert.equal(count, 1);
  assert.equal(db.games()[0]?.title, 'Retro Test');
  assert.ok(events.includes('download') && events.includes('extract') && events.includes('import'));
});

test('ZIP extraction rejects bad CRC and keeps existing catalogue untouched', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-zip-test-'));
  try {
    const bytes = zip(sample);
    const central = bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
    bytes.writeUInt32LE(12345, central + 16);
    const archive = path.join(root, 'db.zip'); const dest = path.join(root, 'db.xml');
    await writeFile(archive, bytes);
    await assert.rejects(openArchive(archive).extract('Metadata.xml', dest), /integrity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing Metadata.xml is rejected without replacing the catalogue', async () => {
  const db = fakeStore();
  await assert.rejects(createUpdater(db.store, async () => response(zip(sample, 'Other.xml'))).download(), /Metadata.xml/);
  assert.equal(db.games()[0]?.title, 'Original');
});

test('aborted download preserves old metadata', async () => {
  const db = fakeStore();
  const controller = new AbortController();
  await assert.rejects(createUpdater(db.store, async () => response(zip(sample))).download({
    signal: controller.signal,
    onProgress: update => { if (update.phase === 'download') controller.abort(); }
  }));
  assert.equal(db.games()[0]?.title, 'Original');
});

test('aborted XML import rolls back staging without discarding the old catalogue', async () => {
  const db = fakeStore();
  const controller = new AbortController();
  await assert.rejects(createUpdater(db.store, async () => response(zip(sample))).download({
    signal: controller.signal,
    onProgress: update => { if (update.phase === 'import') controller.abort(); }
  }));
  assert.equal(db.games()[0]?.title, 'Original');
  assert.equal(db.aborted(), 1);
});

test('ZIP local header and directory identify the one allowed XML entry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-zip-test-'));
  try {
    const archive = path.join(root, 'db.zip'); const dest = path.join(root, 'db.xml');
    await writeFile(archive, zip(sample));
    const entry = await openArchive(archive).findEntry('Metadata.xml');
    assert.equal(entry.size, Buffer.byteLength(sample));
    await openArchive(archive).extract('Metadata.xml', dest);
    assert.equal(await readFile(dest, 'utf8'), sample);
  } finally { await rm(root, { recursive: true, force: true }); }
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
  const updater = createUpdater(db.store, async url => {
    requests.push(String(url));
    if (requests.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/archives/Metadata.zip' } });
    }
    return response(zip(sample));
  });
  assert.equal(await updater.download(), 1);
  assert.deepEqual(requests, [LAUNCHBOX_ARCHIVE_URL, 'https://gamesdb.launchbox-app.com/archives/Metadata.zip']);
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

test('ZIP extraction rejects inconsistent local filenames and preserves an existing output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retrohandler-zip-header-'));
  try {
    const archive = path.join(root, 'db.zip');
    const destination = path.join(root, 'Metadata.xml');
    const bytes = zip(sample);
    bytes[30] = 'X'.charCodeAt(0);
    await writeFile(archive, bytes);
    await assert.rejects(openArchive(archive).findEntry('Metadata.xml'), /header mismatch/);
    await writeFile(archive, zip(sample));
    await writeFile(destination, 'existing');
    await assert.rejects(openArchive(archive).extract('Metadata.xml', destination), /EEXIST/);
    assert.equal(await readFile(destination, 'utf8'), 'existing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
