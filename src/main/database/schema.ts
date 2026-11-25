import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { QueryExecutor } from './sql/query-executor';
import type { DatabaseHandle } from './sql/types';

/** Initial release schema, stored in SQLite's user_version field. */
export const SCHEMA_VERSION = 1;

export function initializeSchema(db: DatabaseHandle, executor: QueryExecutor): void {
  const initialize = db.transaction(() => {
    const { user_version: version } = executor.findRequired<{
      user_version: number
    }>('schema.readVersion');

    if (version !== 0 && version !== SCHEMA_VERSION) {
      throw new Error(`Unsupported RetroHandler database schema version: ${version}`);
    }

    const objects = executor.findAll<{
      name: string
    }>('schema.inspectObjects');
    if (objects.some((object) => object.name === 'schema_version')) {
      throw new Error('Pre-release RetroHandler database detected. Back it up and move it aside before creating a new library.');
    }

    if (version === SCHEMA_VERSION) {
      return;
    }

    // Only an empty, unversioned database can be initialized.
    if (objects.length) {
      throw new Error('Cannot initialize an unversioned, nonempty database.');
    }

    db.exec(readFileSync(path.join(__dirname, 'schema', 'schema.sql'), 'utf8'));
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  initialize();
}
