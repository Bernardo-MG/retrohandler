import { DatabaseConnection } from './database-connection';

export type { DatabaseConnection } from './database-connection';
export { createCollectionRepository } from './repositories/collections';
export { createIdentificationRepository } from './repositories/identification';
export { createLaunchBoxRepository } from './repositories/launchbox';
export { createMetadataRepository } from './repositories/metadata';
export { createRomRepository } from './repositories/roms';

export function openDatabase(filePath: string): DatabaseConnection {
  return DatabaseConnection.open(filePath);
}
