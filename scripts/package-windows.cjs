// Release tooling deliberately operates on fixed repository-relative paths.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');

function cleanRelease(base = root) {
  for (const name of ['dist', 'dist-electron', 'dist-tests', 'release']) {
    fs.rmSync(path.join(base, name), { recursive: true, force: true });
  }
}

function assertX64Pe(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(fd, dos, 0, 64, 0) !== 64 || dos.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error(`Not a PE file: ${file}`);
    }
    const pe = Buffer.alloc(6);
    if (
      fs.readSync(fd, pe, 0, 6, dos.readUInt32LE(60)) !== 6 ||
      pe.readUInt32LE(0) !== 0x4550 ||
      pe.readUInt16LE(4) !== 0x8664
    ) {
      throw new Error(`Expected Windows x64 PE: ${file}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

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

module.exports = { cleanRelease, assertX64Pe, verifyPackage };
if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'clean' && !args.length) {
      cleanRelease();
    } else if (
      command === 'verify' &&
      (args.length === 0 || (args.length === 1 && args[0] === '--directory-only'))
    ) {
      verifyPackage(root, args.includes('--directory-only'));
      console.log('Windows package and runtime smoke test passed.');
    } else {
      throw new Error('Usage: package-windows.cjs clean|verify [--directory-only]');
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
