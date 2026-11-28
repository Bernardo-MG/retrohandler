const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { filesIn, relative };
