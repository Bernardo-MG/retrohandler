// Release tooling deliberately operates on fixed repository-relative paths.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

function cleanRelease(base = root) {
  for (const name of ['dist', 'dist-electron', 'dist-tests', 'release']) {
    fs.rmSync(path.join(base, name), { recursive: true, force: true });
  }
}

module.exports = { cleanRelease };

if (require.main === module) {
  try {
    if (process.argv.length !== 2) {
      throw new Error('Usage: clean-release.cjs');
    }
    cleanRelease();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
