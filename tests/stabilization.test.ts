import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatReader } from '../src/main/identification/dat/dat-reader';
import { inferPlatform } from '../src/main/scanner/platforms';
import { parse7ZipListing } from '../src/main/components/archives/seven-zip-reader';
import { ArtworkCache } from '../src/main/components/artwork/artwork-cache';

const datReader = new DatReader();
const rom = (size = '12', name = 'real.nes') => `<rom name="${name}" size="${size}" crc="12345678"/>`;
const dat = (body: string) => `<datafile><game name="Game">${body}</game></datafile>`;

test('scanner ignores inherited object keys in ancestor names', () => {
  assert.equal(inferPlatform(path.join('constructor', 'game.nes')), 'Nintendo Entertainment System');
  assert.equal(inferPlatform(path.join('constructor', 'game.zip')), 'Needs identification');
  assert.equal(inferPlatform(path.join('constructor', 'snes', 'game.zip')), 'Super Nintendo');
});

test('DAT ignores commented-out ROM records and CDATA markup', () => {
  const parsed = datReader.parse(dat(`<!-- ${rom('12', 'fake.nes')} --><![CDATA[${rom('12', 'fake2.nes')}]]>${rom()}`));
  assert.deepEqual(parsed.entries.map(entry => entry.file), ['real.nes']);
});

test('DAT refuses a catalogue containing only commented-out games', () => {
  assert.throws(() => datReader.parse(`<datafile><!-- <game name="Fake">${rom()}</game> --></datafile>`), /No supported ROM hashes/);
});

test('DAT accepts decimal sizes only, including zero', () => {
  const invalid = [' ', '0x10', '1e2', '2.0', '-1', '+1', '9007199254740992'];
  const parsed = datReader.parse(dat(invalid.map(size => rom(size, 'invalid.nes')).join('') + rom('0', 'empty.nes') + rom()));
  assert.deepEqual(parsed.entries.map(entry => [entry.file, entry.size]), [['empty.nes', 0], ['real.nes', 12]]);
});

test('DAT still rejects actual entity and DTD declarations', () => {
  assert.throws(() => datReader.parse(`<!DOCTYPE datafile>${dat(rom())}`), /DTD/);
  assert.throws(() => datReader.parse(`<!ENTITY example "test">${dat(rom())}`), /DTD/);
});

test('DAT file import rejects directories and oversized files and reads normal files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-stabilization-'));
  try {
    await assert.rejects(datReader.read(root));
    const file = path.join(root, 'test.dat');
    await writeFile(file, dat(rom()));
    assert.equal((await datReader.read(file)).entries.length, 1);
    const handle = await open(file, 'r+');
    try { await handle.truncate(64 * 1024 * 1024 + 1); } finally { await handle.close(); }
    await assert.rejects(datReader.read(file), /64 MiB/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('DAT refuses incomplete root and unfinished comment or CDATA', () => {
  assert.throws(() => datReader.parse(dat(rom()).replace('</datafile>', '')), /Incomplete/);
  assert.throws(() => datReader.parse(dat(`<!-- ${rom()}`)), /Incomplete/);
  assert.throws(() => datReader.parse(dat(`<![CDATA[${rom()}`)), /Incomplete/);
});

test('7-Zip listing uses a separator line, not hyphens in an archive name', () => {
  const output = 'Path = sample----------.zip\nType = zip\n----------\nPath = game.nes\nSize = 12\n';
  assert.deepEqual(parse7ZipListing(output), [{ name: 'game.nes', size: 12, directory: false }]);
  assert.throws(() => parse7ZipListing('Path = sample----------.zip\nSize = 12'), /Invalid 7-Zip/);
});

test('7-Zip listing rejects blank, fractional and non-decimal member sizes', () => {
  for (const size of ['', ' ', '1e2', '0x10', '2.0', '-1', '9007199254740992']) {
    assert.throws(() => parse7ZipListing(`----------\nPath = game.nes\nSize = ${size}\n`), /invalid member size/);
  }
  assert.equal(parse7ZipListing('----------\nPath = game.nes\nSize = 0\n')[0].size, 0);
});

test('cached artwork is validated against its content address', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-artwork-integrity-'));
  try {
    const cache = new ArtworkCache(root);
    const original = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const id = await cache.store(original);
    assert.deepEqual((await cache.read(id)).body, original);
    await writeFile(path.join(root, id), Buffer.from([0xff, 0xd8, 0xff, 0x02]));
    await assert.rejects(cache.read(id), /Invalid cached artwork/);
    // Re-caching the original image repairs the entry under the same ID.
    assert.equal(await cache.store(original), id);
    assert.deepEqual((await cache.read(id)).body, original);
    const handle = await open(path.join(root, id), 'r+');
    try { await handle.truncate(5 * 1024 * 1024 + 1); } finally { await handle.close(); }
    await assert.rejects(cache.read(id), /Invalid cached artwork/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
