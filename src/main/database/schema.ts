import { finishLegacySchema, prepareLegacySchema } from './migrations/legacy';
import { readCanonicalSchema, sql } from './query-loader';
import type { DatabaseHandle } from './types';

/** The one current database version. Existing version-6 libraries need no migration. */
export const SCHEMA_VERSION = 6;

function readVersion(db: DatabaseHandle): number | null {
  const objects = db.prepare(sql('schema.inspectObjects')).all() as {
    name: string
  }[];
  if (!objects.some((object) => object.name === 'schema_version')) {
    if (objects.length) {
      throw new Error('Cannot initialize an unversioned, nonempty database.');
    }
    return null;
  }
  const versions = db.prepare(sql('schema.readVersion')).all() as {
    version: number
  }[];
  if (versions.length !== 1 || !Number.isSafeInteger(versions[0].version)) {
    throw new Error('Invalid RetroHandler database schema version.');
  }
  const version = versions[0].version;
  if (version < 1 || version > SCHEMA_VERSION) {
    throw new Error(`Unsupported RetroHandler database schema version: ${version}`);
  }
  return version;
}

/** Fresh installations create the final schema in one transaction. Existing data
 * stays in place; legacy adjustments and the final version update are atomic. */
export function initializeSchema(db: DatabaseHandle): void {
  const schema = readCanonicalSchema();
  const initialize = db.transaction(() => {
    const version = readVersion(db);
    if (version !== null && version < SCHEMA_VERSION) {
      prepareLegacySchema(db, version);
    }

    // CREATE IF NOT EXISTS also adds the formerly lazy LaunchBox tables on v6.
    db.exec(schema);

    if (version === null) {
      db.prepare(sql('schema.insertVersion')).run(SCHEMA_VERSION);
    } else if (version < SCHEMA_VERSION) {
      finishLegacySchema(db);
      db.prepare(sql('schema.updateVersion')).run(SCHEMA_VERSION);
    }
  });
  initialize();
}
