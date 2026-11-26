import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameListDocument } from '../src/main/components/emulationstation/gamelist-document';
import { GameListMerger } from '../src/main/components/emulationstation/gamelist-merger';

const doc = (records: string) => `<gameList>${records}</gameList>`;
const resolvePath = (value: string): string | null => {
  if (value.startsWith('/target/games/')) return value.slice('/target/games/'.length);
  if (value.startsWith('./')) return value.slice(2);
  return null;
};

const merger = new GameListMerger(resolvePath);

test('gamelist writer accepts caller-supplied paths and escapes metadata', () => {
  const xml = GameListDocument.fromEntries([{
    path: './nested/A&B.zip', name: 'A < B', image: '../covers/A&B.png', released: '2000-02-29'
  }]).toXml();
  const [record] = GameListDocument.parse(xml).records;
  assert.deepEqual(record.fields.map(({ name, value }) => [name, value]), [
    ['path', './nested/A&B.zip'], ['name', 'A < B'], ['image', '../covers/A&B.png'],
    ['releasedate', '20000229T000000']
  ]);
  assert.equal(record.name, 'game');
});

test('gamelist parser exposes source spans and preserves decoded text', () => {
  const xml = doc('<!--keep--><folder><path>./extras</path><name><![CDATA[A & B]]></name></folder>');
  const [record] = GameListDocument.parse(xml).records;
  assert.equal(record.name, 'folder');
  assert.equal(xml.slice(record.start, record.end), '<folder><path>./extras</path><name><![CDATA[A & B]]></name></folder>');
  assert.equal(record.fields[1].value, 'A & B');
  assert.equal(xml.slice(record.fields[1].start, record.fields[1].end), '<name><![CDATA[A & B]]></name>');
});

test('gamelist merger uses a target-specific path resolver and preserves original paths', () => {
  const existing = doc('<!--keep--><game><path>/target/games/A.zip</path><name>Old</name><favorite>true</favorite></game>');
  const generated = GameListDocument.fromEntries([{ path: './A.zip', name: 'New' }]);
  const merged = merger.merge(GameListDocument.parse(existing), generated);
  assert.equal(merged, existing.replace('<name>Old</name>', '<name>New</name>'));
  assert.equal(merger.merge(GameListDocument.parse(merged), generated), merged);
});

test('gamelist merger preserves fallback titles and rejects unresolved collisions', () => {
  const existing = doc('<game><path>./A.zip</path><name>Scraped</name></game>');
  const generated = GameListDocument.fromEntries([{ path: './A.zip', name: 'A' }]);
  assert.equal(merger.merge(GameListDocument.parse(existing), generated, new Set(['A.zip'])), existing);
  assert.throws(() => merger.merge(GameListDocument.parse(existing.replace('./A.zip', '/elsewhere/A.zip')), generated), /Unmapped existing ROM path/);
});

test('gamelist parser rejects invalid structures rather than repairing them', () => {
  for (const xml of [doc('<game><name>Missing path</name></game>'), doc('<game><path>./A.zip</path><path>./B.zip</path></game>'), doc('<unknown/>'), '<!DOCTYPE gameList><gameList/>']) {
    assert.throws(() => GameListDocument.parse(xml), /Malformed or unsupported gamelist XML/);
  }
});

test('document and merger instances preserve independent source spans across repeated merges', () => {
  const first = GameListDocument.parse(doc('<game><path>./A.zip</path><name>Old A</name></game>'));
  const second = GameListDocument.parse(doc('<game><path>./B.zip</path><name>Old B</name></game>'));
  const generated = GameListDocument.fromEntries([{ path: './A.zip', name: 'New A' }]);
  assert.equal(first.records[0].path, './A.zip');
  assert.equal(first.slice(first.records[0].fields[1]), '<name>Old A</name>');
  assert.equal(merger.merge(first, generated), first.toXml().replace('Old A', 'New A'));
  const result = merger.merge(second, generated);
  assert.match(result, /Old B/);
  assert.match(result, /New A/);
  assert.equal(GameListDocument.parse(result).records.length, 2);
  assert.match(first.toXml(), /Old A/);
});
