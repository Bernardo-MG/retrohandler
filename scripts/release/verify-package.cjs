const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertX64Pe } = require('./pe-validator.cjs');
const root = path.resolve(__dirname, '../..');
const manifest = require('../../package.json');

function assertNonempty(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || !st.size) {
    throw new Error(`Missing or empty file: ${file}`);
  }
}

function verifyPackage(base = root, directoryOnly = false, runSmoke = true) {
  const release = path.join(base, 'release');
  const unpacked = path.join(release, 'win-unpacked');
  const executable = path.join(unpacked, 'RetroHandler.exe');
  const resources = path.join(unpacked, 'resources');
  assertX64Pe(executable);
  assertNonempty(path.join(resources, 'app.asar'));
  assertX64Pe(
    path.join(
      resources,
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node'
    )
  );
  if (!directoryOnly) {
    // NSIS installers may have a 32-bit bootstrap even for an x64 payload.
    assertNonempty(path.join(release, `RetroHandler-Setup-${manifest.version}-x64.exe`));
  }
  if (runSmoke) {
    if (process.platform !== 'win32') {
      throw new Error('Packaged runtime verification requires Windows.');
    }
    const result = spawnSync(executable, ['--retrohandler-package-smoke'], {
      timeout: 60000,
      windowsHide: true,
      stdio: 'inherit'
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Packaged smoke test failed: ${result.error || result.signal || result.status}`);
    }
  }
  return executable;
}

module.exports = { verifyPackage };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && !(args.length === 1 && args[0] === '--directory-only')) {
      throw new Error('Usage: verify-package.cjs [--directory-only]');
    }
    verifyPackage(root, args.includes('--directory-only'));
    console.log('Windows package and runtime smoke test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
