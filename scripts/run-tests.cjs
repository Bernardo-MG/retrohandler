const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');

const root = path.resolve(__dirname, '..');
const compiled = path.join(root, 'dist-tests');

function filesIn(directory, predicate) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return filesIn(filename, predicate);
      }
      return entry.isFile() && predicate(filename) ? [filename] : [];
    })
    .sort();
}

function relative(projectRoot, file) {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

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

function reportCoverageScope(directory) {
  const exclusions = require('../coverage-exclusions.json');
  const scope = coverageScope(root, directory, exclusions);
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

function runTests(coverage) {
  const tests = discoverTests(root);
  if (!tests.length) {
    throw new Error('No tests discovered.');
  }
  const directory = coverage ? fs.mkdtempSync(path.join(os.tmpdir(), 'retrohandler-coverage-')) : null;
  const args = ['--test'];
  if (coverage) {
    args.push(
      '--experimental-test-coverage',
      '--test-coverage-include=dist-tests/src/**/*.js',
      '--test-coverage-lines=90',
      '--test-coverage-branches=85',
      '--test-coverage-functions=90'
    );
  }
  try {
    const result = spawnSync(process.execPath, [...args, ...tests], {
      cwd: root,
      stdio: 'inherit',
      env: directory ? { ...process.env, NODE_V8_COVERAGE: directory } : process.env
    });
    if (result.error) {
      throw result.error;
    }
    if (directory && !reportCoverageScope(directory)) {
      return 1;
    }
    return result.status ?? 1;
  } finally {
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

module.exports = { discoverTests, coverageScope };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--clean') {
      fs.rmSync(compiled, { recursive: true, force: true });
    } else if (args.length === 0 || (args.length === 1 && args[0] === '--coverage')) {
      process.exitCode = runTests(args.includes('--coverage'));
    } else {
      throw new Error('Usage: run-tests.cjs [--clean|--coverage]');
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
