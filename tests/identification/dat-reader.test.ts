import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatReader } from '../../src/main/identification/dat/dat-reader';

const datReader = new DatReader();
const rom = (size = '12', name = 'real.nes') => `<rom name="${name}" size="${size}" crc="12345678"/>`;
const dat = (body: string) => `<datafile><game name="Game">${body}</game></datafile>`;

test('DAT ignores commented-out ROM records and CDATA markup', () => {
  const parsed = datReader.parse(
    dat(`<!-- ${rom('12', 'fake.nes')} --><![CDATA[${rom('12', 'fake2.nes')}]]>${rom()}`)
  );
  assert.deepEqual(
    parsed.entries.map((entry) => entry.file),
    ['real.nes']
  );
});

test('DAT refuses a catalogue containing only commented-out games', () => {
  assert.throws(
    () => datReader.parse(`<datafile><!-- <game name="Fake">${rom()}</game> --></datafile>`),
    /No supported ROM hashes/
  );
});

test('DAT accepts decimal sizes only, including zero', () => {
  const invalid = [' ', '0x10', '1e2', '2.0', '-1', '+1', '9007199254740992'];
  const parsed = datReader.parse(
    dat(invalid.map((size) => rom(size, 'invalid.nes')).join('') + rom('0', 'empty.nes') + rom())
  );
  assert.deepEqual(
    parsed.entries.map((entry) => [entry.file, entry.size]),
    [
      ['empty.nes', 0],
      ['real.nes', 12]
    ]
  );
});

test('DAT rejects entity and DTD declarations', () => {
  assert.throws(() => datReader.parse(`<!DOCTYPE datafile>${dat(rom())}`), /DTD/);
  assert.throws(() => datReader.parse(`<!ENTITY example "test">${dat(rom())}`), /DTD/);
});

test('DAT file import rejects directories and oversized files and reads normal files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-dat-reader-'));
  try {
    await assert.rejects(datReader.read(root));
    const file = path.join(root, 'test.dat');
    await writeFile(file, dat(rom()));
    assert.equal((await datReader.read(file)).entries.length, 1);
    const handle = await open(file, 'r+');
    try {
      await handle.truncate(64 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    await assert.rejects(datReader.read(file), /64 MiB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DAT refuses incomplete root and unfinished comment or CDATA', () => {
  assert.throws(() => datReader.parse(dat(rom()).replace('</datafile>', '')), /Incomplete/);
  assert.throws(() => datReader.parse(dat(`<!-- ${rom()}`)), /Incomplete/);
  assert.throws(() => datReader.parse(dat(`<![CDATA[${rom()}`)), /Incomplete/);
});
