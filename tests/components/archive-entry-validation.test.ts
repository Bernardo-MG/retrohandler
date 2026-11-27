import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertArchiveEntryCount,
  assertArchiveEntrySize,
  isValidArchiveEntrySize
} from '../../src/main/components/archives/archive-entry-validation';

test('archive entry sizes are nonnegative safe integers within the configured maximum', () => {
  assert.equal(isValidArchiveEntrySize(0, 0), true);
  assert.equal(isValidArchiveEntrySize(10, 10), true);
  for (const size of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 11]) {
    assert.equal(isValidArchiveEntrySize(size, 10), false);
    assert.throws(() => assertArchiveEntrySize(size, 10), /size limit/);
  }
  assert.doesNotThrow(() => assertArchiveEntrySize(10, 10));
  assert.throws(() => assertArchiveEntrySize(11, 10, 'Custom size error.'), /Custom size error/);
});

test('entry count validation allows the configured boundary but rejects invalid counts', () => {
  assert.doesNotThrow(() => assertArchiveEntryCount(0, 10));
  assert.doesNotThrow(() => assertArchiveEntryCount(10, 10));
  for (const count of [-1, 1.5, NaN, Infinity, 11]) {
    assert.throws(() => assertArchiveEntryCount(count, 10), /Too many archive entries/);
  }
});
