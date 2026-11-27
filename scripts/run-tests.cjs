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

function discoverTests(projectRoot) {
  return [
    ...filesIn(path.join(projectRoot, 'dist-tests', 'tests'), (file) => file.endsWith('.test.js')),
    ...filesIn(path.join(projectRoot, 'tests'), (file) => file.endsWith('.test.cjs'))
  ];
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function reportCoverageScope(directory) {
  const loaded = new Set();
  for (const file of filesIn(directory, (name) => name.endsWith('.json'))) {
    const coverage = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const script of coverage.result ?? []) {
      if (script.url.startsWith('file:')) {
        loaded.add(path.normalize(fileURLToPath(script.url)));
      }
    }
  }
  const compiledSource = path.join(compiled, 'src');
  const unexecuted = filesIn(compiledSource, (name) => name.endsWith('.js')).filter((file) => {
    // Type-only modules emit just the CommonJS module marker; they have no behavior to test.
    const content = fs
      .readFileSync(file, 'utf8')
      .replace(/^\s*["']use strict["'];\s*/u, '')
      .replace(/^\s*Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);\s*/u, '');
    return !loaded.has(file) && content.trim().length > 0;
  });
  const notCompiled = filesIn(
    path.join(root, 'src'),
    (name) => /\.tsx?$/u.test(name) && !name.endsWith('.d.ts')
  ).filter((file) => !fs.existsSync(path.join(compiled, relative(file).replace(/\.tsx?$/u, '.js'))));
  console.log('\nCoverage scope (compiled JavaScript; unloaded modules do not enter Node’s totals):');
  console.log(`  Compiled modules not loaded: ${unexecuted.length}`);
  for (const file of unexecuted) {
    console.log(`    ${relative(file)}`);
  }
  console.log(`  TypeScript modules outside the Node test build: ${notCompiled.length}`);
  for (const file of notCompiled) {
    console.log(`    ${relative(file)}`);
  }
  console.log(
    '  React rendering, native Electron execution and packaged runtime require separate validation.'
  );
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
      '--test-coverage-include=scripts/*.cjs'
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
    if (directory) {
      reportCoverageScope(directory);
    }
    return result.status ?? 1;
  } finally {
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

module.exports = { discoverTests };

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
