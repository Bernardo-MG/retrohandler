import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { inferPlatform } from '../../src/main/scanner/platforms';

test('scanner ignores inherited object keys in ancestor names', () => {
  assert.equal(inferPlatform(path.join('constructor', 'game.nes')), 'Nintendo Entertainment System');
  assert.equal(inferPlatform(path.join('constructor', 'game.zip')), 'Needs identification');
  assert.equal(inferPlatform(path.join('constructor', 'snes', 'game.zip')), 'Super Nintendo');
});
