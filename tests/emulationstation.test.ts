import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeGameList } from '../src/main/components/emulationstation/gamelist-writer';
import { parseGameList } from '../src/main/components/emulationstation/gamelist-parser';
import { mergeGameLists } from '../src/main/components/emulationstation/gamelist-merger';

const doc = (records: string) => `<gameList>${records}</gameList>`;
const resolvePath = (value: string): string | null => {
  if (value.startsWith('/target/games/')) return value.slice('/target/games/'.length);
  if (value.startsWith('./')) return value.slice(2);
  return null;
};

test('gamelist writer accepts caller-supplied paths and escapes metadata', () => {
  const xml = writeGameList([{
    path: './nested/A&B.zip', name: 'A < B', image: '../covers/A&B.png', released: '2000-02-29'
  }]);
  const [record] = parseGameList(xml).records;
  assert.deepEqual(record.fields.map(({ name, value }) => [name, value]), [
    ['path', './nested/A&B.zip'], ['name', 'A < B'], ['image', '../covers/A&B.png'],
    ['releasedate', '20000229T000000']
  ]);
  assert.equal(record.name, 'game');
});

test('gamelist parser exposes source spans and preserves decoded text', () => {
  const xml = doc('<!--keep--><folder><path>./extras</path><name><![CDATA[A & B]]></name></folder>');
  const [record] = parseGameList(xml).records;
  assert.equal(record.name, 'folder');
  assert.equal(xml.slice(record.start, record.end), '<folder><path>./extras</path><name><![CDATA[A & B]]></name></folder>');
  assert.equal(record.fields[1].value, 'A & B');
  assert.equal(xml.slice(record.fields[1].start, record.fields[1].end), '<name><![CDATA[A & B]]></name>');
});

test('gamelist merger uses a target-specific path resolver and preserves original paths', () => {
  const existing = doc('<!--keep--><game><path>/target/games/A.zip</path><name>Old</name><favorite>true</favorite></game>');
  const generated = writeGameList([{ path: './A.zip', name: 'New' }]);
  const merged = mergeGameLists(existing, generated, resolvePath);
  assert.equal(merged, existing.replace('<name>Old</name>', '<name>New</name>'));
  assert.equal(mergeGameLists(merged, generated, resolvePath), merged);
});

test('gamelist merger preserves fallback titles and rejects unresolved collisions', () => {
  const existing = doc('<game><path>./A.zip</path><name>Scraped</name></game>');
  const generated = writeGameList([{ path: './A.zip', name: 'A' }]);
  assert.equal(mergeGameLists(existing, generated, resolvePath, new Set(['A.zip'])), existing);
  assert.throws(() => mergeGameLists(existing.replace('./A.zip', '/elsewhere/A.zip'), generated, resolvePath), /Unmapped existing ROM path/);
});

test('gamelist parser rejects invalid structures rather than repairing them', () => {
  for (const xml of [doc('<game><name>Missing path</name></game>'), doc('<game><path>./A.zip</path><path>./B.zip</path></game>'), doc('<unknown/>'), '<!DOCTYPE gameList><gameList/>']) {
    assert.throws(() => parseGameList(xml), /Malformed or unsupported gamelist XML/);
  }
});
