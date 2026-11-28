import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  developmentRendererUrl,
  packagedRendererPath,
  preloadPath
} from '../../src/main/desktop/window/renderer-paths';

const root = path.resolve('application');
const directory = path.join(root, 'dist-electron', 'main', 'desktop', 'window');

test('desktop module relocation preserves packaged renderer and preload locations', () => {
  assert.equal(preloadPath(directory), path.join(root, 'dist-electron', 'preload', 'preload.js'));
  assert.equal(packagedRendererPath(directory), path.join(root, 'dist', 'index.html'));
});

test('only the approved local development URL can override the renderer', () => {
  const url = 'http://127.0.0.1:5173';
  assert.equal(developmentRendererUrl(false, url), url);
  assert.equal(developmentRendererUrl(false, `${url}/`), `${url}/`);
  assert.equal(developmentRendererUrl(true, url), undefined);
  for (const invalid of [undefined, '', 'http://localhost:5173', `${url}/other`, `${url}?query`]) {
    assert.equal(developmentRendererUrl(false, invalid), undefined);
  }
});
