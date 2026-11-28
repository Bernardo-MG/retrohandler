const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { discoverTests } = require('./test-discovery.cjs');
const { reportCoverageScope } = require('./coverage-scope.cjs');

const root = path.resolve(__dirname, '../..');
const compiled = path.join(root, 'dist-tests');

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
    if (directory && !reportCoverageScope(root, directory)) {
      return 1;
    }
    return result.status ?? 1;
  } finally {
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

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
