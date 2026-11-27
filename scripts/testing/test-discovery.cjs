const path = require('node:path');
const { filesIn, relative } = require('./test-files.cjs');

function discoverTests(projectRoot) {
  const source = path.join(projectRoot, 'tests');
  const compiledTests = filesIn(path.join(projectRoot, 'dist-tests', 'tests'), (file) =>
    file.endsWith('.test.js')
  );
  const expected = new Set(
    filesIn(source, (file) => file.endsWith('.test.ts')).map((file) =>
      path.join(projectRoot, 'dist-tests', relative(projectRoot, file).replace(/\.ts$/u, '.js'))
    )
  );
  const actual = new Set(compiledTests);
  const missing = [...expected].filter((file) => !actual.has(file));
  const stale = compiledTests.filter((file) => !expected.has(file));
  if (missing.length || stale.length) {
    throw new Error(
      `Test discovery mismatch: missing ${missing.join(', ')}; stale ${stale.join(', ')}. Rebuild the tests.`
    );
  }
  return [...compiledTests, ...filesIn(source, (file) => file.endsWith('.test.cjs'))];
}

module.exports = { discoverTests };
