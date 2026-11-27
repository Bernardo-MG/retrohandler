const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { filesIn, relative } = require('./test-files.cjs');

function coverageScope(projectRoot, directory, exclusions) {
  const loaded = new Set();
  for (const file of filesIn(directory, (name) => name.endsWith('.json'))) {
    const coverage = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const script of coverage.result ?? []) {
      if (script.url.startsWith('file:')) {
        loaded.add(path.normalize(fileURLToPath(script.url)));
      }
    }
  }
  const compiledRoot = path.join(projectRoot, 'dist-tests');
  const unloaded = filesIn(path.join(compiledRoot, 'src'), (name) => name.endsWith('.js'))
    .filter((file) => {
      // Type-only modules emit just the CommonJS module marker; they have no behavior to test.
      const content = fs
        .readFileSync(file, 'utf8')
        .replace(/^\s*["']use strict["'];\s*/u, '')
        .replace(/^\s*Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);\s*/u, '');
      return !loaded.has(file) && content.trim().length > 0;
    })
    .map((file) => relative(projectRoot, file));
  const notCompiled = filesIn(
    path.join(projectRoot, 'src'),
    (name) => /\.tsx?$/u.test(name) && !name.endsWith('.d.ts')
  )
    .map((file) => relative(projectRoot, file))
    .filter((file) => !fs.existsSync(path.join(compiledRoot, file.replace(/\.tsx?$/u, '.js'))));
  const unexpected = notCompiled.filter((file) => !Object.hasOwn(exclusions, file));
  const obsolete = Object.keys(exclusions).filter((file) => !notCompiled.includes(file));
  return { unloaded, notCompiled, unexpected, obsolete };
}

function reportCoverageScope(projectRoot, directory) {
  const exclusions = require('../../coverage-exclusions.json');
  const scope = coverageScope(projectRoot, directory, exclusions);
  console.log('\nCoverage scope (compiled application JavaScript):');
  for (const file of scope.notCompiled) {
    console.log(`  Outside Node coverage: ${file} (${exclusions[file] ?? 'UNEXPECTED'})`);
  }
  for (const file of scope.unloaded) {
    console.error(`  Unloaded application module: ${file}`);
  }
  for (const file of scope.obsolete) {
    console.error(`  Obsolete coverage exclusion: ${file}`);
  }
  return !scope.unloaded.length && !scope.unexpected.length && !scope.obsolete.length;
}

module.exports = { coverageScope, reportCoverageScope };
