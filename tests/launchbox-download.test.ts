import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { downloadLaunchBox, extractMetadataXml, locateMetadataXml, LAUNCHBOX_ARCHIVE_URL } from '../src/main/metadata/launchbox-download';
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
const response = (bytes: Buffer) => new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Length': String(bytes.length) } });

test('downloads fixed official URL, extracts ZIP and commits the parsed catalogue', async () => {
  const db = fakeStore();
  const events: string[] = [];
  const count = await downloadLaunchBox(db.store, {
    request: (async (url: string | URL | Request) => {
      assert.equal(String(url), LAUNCHBOX_ARCHIVE_URL);
      return response(zip(sample));
    }) as typeof fetch,
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
    await assert.rejects(extractMetadataXml(archive, dest), /integrity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing Metadata.xml is rejected without replacing the catalogue', async () => {
  const db = fakeStore();
  await assert.rejects(downloadLaunchBox(db.store, {request: (async () => response(zip(sample, 'Other.xml'))) as typeof fetch}), /Metadata.xml/);
  assert.equal(db.games()[0]?.title, 'Original');
});

test('aborted download preserves old metadata', async () => {
  const db = fakeStore();
  const controller = new AbortController();
  await assert.rejects(downloadLaunchBox(db.store, {
    signal: controller.signal,
    request: (async () => response(zip(sample))) as typeof fetch,
    onProgress: update => { if (update.phase === 'download') controller.abort(); }
  }));
  assert.equal(db.games()[0]?.title, 'Original');
});

test('aborted XML import rolls back staging without discarding the old catalogue', async () => {
  const db = fakeStore();
  const controller = new AbortController();
  await assert.rejects(downloadLaunchBox(db.store, {
    signal: controller.signal,
    request: (async () => response(zip(sample))) as typeof fetch,
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
    const entry = await locateMetadataXml(archive);
    assert.equal(entry.size, Buffer.byteLength(sample));
    await extractMetadataXml(archive, dest);
    assert.equal(await readFile(dest, 'utf8'), sample);
  } finally { await rm(root, { recursive: true, force: true }); }
});
