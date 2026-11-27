import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  selectEntryByBasename,
  selectEntryByName,
  selectUniqueEntry
} from '../../src/main/components/archives';

const nested = { name: 'folder/Metadata.xml', size: 12, directory: false };
const root = { ...nested, name: 'Metadata.xml' };
const directory = { ...root, directory: true };

test('exact archive entry selection is literal and detects duplicates', () => {
  assert.deepEqual(selectEntryByName([nested], nested.name), { kind: 'found', entry: nested });
  assert.deepEqual(selectEntryByName([nested], root.name), { kind: 'missing' });
  assert.deepEqual(selectEntryByName([nested], 'folder/metadata.xml'), { kind: 'missing' });
  assert.deepEqual(selectEntryByName([nested], 'folder/../folder/Metadata.xml'), { kind: 'missing' });
  assert.deepEqual(selectEntryByName([nested, { ...nested }], nested.name), { kind: 'ambiguous' });
});

test('basename selection ignores directories, matches archive paths and detects ambiguity', () => {
  assert.deepEqual(selectEntryByBasename([directory, nested], root.name), { kind: 'found', entry: nested });
  assert.deepEqual(selectEntryByBasename([directory], root.name), { kind: 'missing' });
  assert.deepEqual(selectEntryByBasename([nested, root], root.name), { kind: 'ambiguous' });
  assert.deepEqual(selectEntryByBasename([nested], 'metadata.xml'), { kind: 'missing' });
  assert.deepEqual(selectEntryByBasename([{ ...nested, name: 'otherMetadata.xml' }], root.name), {
    kind: 'missing'
  });
});

test('selection supports streamed entries and propagates validation failures', () => {
  function* entries() {
    yield root;
    yield nested;
  }
  assert.deepEqual(
    selectUniqueEntry(entries(), (entry) => entry.name === nested.name),
    {
      kind: 'found',
      entry: nested
    }
  );
  assert.throws(
    () =>
      selectEntryByName(entries(), root.name, () => {
        throw new Error('Invalid entry.');
      }),
    /Invalid entry/
  );
});
