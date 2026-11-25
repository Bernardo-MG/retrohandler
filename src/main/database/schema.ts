import { readCanonicalSchema, sql } from './query-loader';
import type { DatabaseHandle } from './types';

/** Initial release schema, stored in SQLite's user_version field. */
export const SCHEMA_VERSION = 1;

export function initializeSchema(db: DatabaseHandle): void {
  const initialize = db.transaction(() => {
    const { user_version: version } = db.prepare(sql('schema.readVersion')).get() as {
      user_version: number
    };

    if (version !== 0 && version !== SCHEMA_VERSION) {
      throw new Error(`Unsupported RetroHandler database schema version: ${version}`);
    }

    const objects = db.prepare(sql('schema.inspectObjects')).all() as {
      name: string
    }[];
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

    db.exec(readCanonicalSchema());
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  initialize();
}
