import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { childOf } from '../../src/main/utils/paths';

test('containment rejects equal paths, siblings and parent traversal', () => {
  const root = path.resolve('root');
  const child = path.join(root, 'child');
  assert.equal(childOf(root, child), true);
  assert.equal(childOf(root, root), false);
  assert.equal(childOf(root, `${root}-other`), false);
  assert.equal(childOf(root, path.resolve(root, '..')), false);
});
