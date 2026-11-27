import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveExtension, isArchiveExtension } from '../../src/main/components/archives/archive-formats';

test('archive extension recognition is case insensitive and does not recognize unrelated formats', () => {
  for (const extension of ['.zip', '.ZIP', '.7z', '.7Z', '.rar', '.RAR']) {
    assert.equal(isArchiveExtension(extension), true);
  }
  for (const extension of ['', '.iso', '.nes', '.txt', 'zip']) {
    assert.equal(isArchiveExtension(extension), false);
  }
  assert.equal(archiveExtension('game.backup.ZIP'), '.zip');
  assert.equal(archiveExtension('game'), '');
});
