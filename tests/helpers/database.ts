import { DatabaseConnection } from '../../src/main/database/database-connection';
import {
  createCollectionRepository,
  createRomRepository,
  createIdentificationRepository,
  createMetadataRepository,
  createLaunchBoxRepository
} from '../../src/main/database';
import type { DatabaseFactory } from '../../src/main/database/sql/types';

/** Integration-test fixture. Production code constructs only the repositories it needs. */
export function openTestRepositories(file: string, adapter: DatabaseFactory) {
  const database = DatabaseConnection.open(file, adapter);
  return {
    database,
    collections: createCollectionRepository(database),
    roms: createRomRepository(database),
    identification: createIdentificationRepository(database),
    metadata: createMetadataRepository(database),
    launchBox: createLaunchBoxRepository(database)
  };
}

export type TestRepositories = ReturnType<typeof openTestRepositories>;
