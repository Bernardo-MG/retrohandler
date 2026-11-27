const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { describe, it } = require('node:test');
const { coverageScope } = require('../../scripts/testing/coverage-scope.cjs');
const { discoverTests } = require('../../scripts/testing/test-discovery.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retrohandler-quality-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(file, content = '') {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  }
  return { root, write };
}

describe('Quality gates', () => {
  it('rejects missing and stale compiled test files', (t) => {
    const { root, write } = fixture(t);
    write('tests/missing.test.ts');
    write('dist-tests/tests/stale.test.js');
    assert.throws(() => discoverTests(root), /missing .*missing\.test\.js; stale .*stale\.test\.js/);
  });

  it('reports unloaded behavior, unexpected omissions and obsolete exclusions', (t) => {
    const { root, write } = fixture(t);
    const loaded = write('dist-tests/src/loaded.js', 'exports.value = 1;');
    write('dist-tests/src/unloaded.js', 'exports.value = 2;');
    write(
      'dist-tests/src/types.js',
      '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });'
    );
    for (const file of ['loaded.ts', 'unloaded.ts', 'types.ts', 'native.ts', 'unexpected.ts']) {
      write(`src/${file}`);
    }
    write('coverage/result.json', JSON.stringify({ result: [{ url: pathToFileURL(loaded).href }] }));
    const scope = coverageScope(root, path.join(root, 'coverage'), {
      'src/native.ts': 'Native runtime',
      'src/obsolete.ts': 'Old exclusion'
    });
    assert.deepEqual(scope.unloaded, ['dist-tests/src/unloaded.js']);
    assert.deepEqual(scope.notCompiled, ['src/native.ts', 'src/unexpected.ts']);
    assert.deepEqual(scope.unexpected, ['src/unexpected.ts']);
    assert.deepEqual(scope.obsolete, ['src/obsolete.ts']);
  });
});
