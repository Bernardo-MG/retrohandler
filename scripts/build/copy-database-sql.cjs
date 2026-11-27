const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'src', 'main', 'database');
const targets = {
  electron: path.join(root, 'dist-electron', 'main', 'database'),
  tests: path.join(root, 'dist-tests', 'src', 'main', 'database')
};

function copyDatabaseSql(target) {
  if (!Object.hasOwn(targets, target)) {
    throw new Error('Usage: copy-database-sql.cjs electron|tests');
  }
  const destination = targets[target];
  for (const directory of ['schema', 'queries']) {
    const from = path.join(source, directory);
    const to = path.join(destination, directory);
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.sql')) {
        fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
      }
    }
  }
}

copyDatabaseSql(process.argv[2]);
