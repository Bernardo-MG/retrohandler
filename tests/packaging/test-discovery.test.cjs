const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { discoverTests } = require('../../scripts/run-tests.cjs');

describe('Test discovery', () => {
  it('finds nested compiled suites and source CommonJS suites, but never helpers', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retrohandler-test-discovery-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const expected = [
      'dist-tests/tests/architecture/rules.test.js',
      'dist-tests/tests/renderer/controllers.test.js',
      'tests/packaging/installer.test.cjs'
    ];
    for (const file of [
      ...expected,
      'dist-tests/tests/helpers/fixture.js',
      'tests/renderer/controllers.test.ts',
      'tests/architecture/rules.test.ts',
      'tests/helpers/fixture.cjs'
    ]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '');
    }
    assert.deepEqual(
      discoverTests(root),
      expected.map((file) => path.join(root, file))
    );
  });
});
