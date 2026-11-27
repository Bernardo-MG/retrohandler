import type { BulkSystemSelection, GameMetadata, GameMetadataInput } from '../../../shared';
import type {
  ArtworkReferences,
  MetadataRepository,
  SystemOverrideRepository
} from '../../contracts/persistence';
import { isArtworkId } from '../../components/artwork/artwork-image';
import { DatabaseConnection } from '../database-connection';
import { QueryExecutor } from '../sql/query-executor';
import { buildFilter, type LibraryFilter } from './library-filter';

type ArtworkRow = {
  artworkId: string | null;
};

type BulkTargetRow = {
  source: string;
  relativePath: string;
  name: string;
};

function buildBulkTargetsQuery(executor: QueryExecutor, filter: LibraryFilter) {
  const { where, params } = buildFilter(executor, filter);
  return { sql: executor.render('library.bulkTargets', { where }), params };
}

export class SqliteMetadataRepository
  implements MetadataRepository, SystemOverrideRepository, ArtworkReferences
{
  constructor(private readonly executor: QueryExecutor) {}

  saveMetadata(source: string, relativePath: string, metadata: GameMetadataInput): GameMetadata {
    if (
      !metadata.title.trim() ||
      metadata.title.length > 200 ||
      metadata.description.length > 4000 ||
      [metadata.released, metadata.developer, metadata.publisher, metadata.genre].some(
        (value) => value.length > 200
      ) ||
      !['manual', 'launchbox'].includes(metadata.provider) ||
      (metadata.providerId !== null && metadata.providerId.length > 80) ||
      (metadata.providerSlug !== null && !/^[a-z0-9-]{1,150}$/.test(metadata.providerSlug)) ||
      (metadata.artworkId !== null && !isArtworkId(metadata.artworkId)) ||
      (metadata.systemOverride !== undefined &&
        metadata.systemOverride !== null &&
        (typeof metadata.systemOverride !== 'string' ||
          !metadata.systemOverride.trim() ||
          metadata.systemOverride.length > 120 ||
          /[\x00-\x1f]/.test(metadata.systemOverride)))
    ) {
      throw new Error('Invalid game metadata.');
    }
    // FK guarantees that the target is an indexed ROM. Never writes to ROM folders.
    const exists = this.executor.findOne<{ found: number }>('roms.exists', source, relativePath);
    if (!exists) {
      throw new Error('Game not found in the library.');
    }
    const previous = this.executor.findOne<{ systemOverride: string | null }>(
      'metadata.getSystemOverride',
      source,
      relativePath
    );
    const systemOverride =
      metadata.systemOverride === undefined
        ? (previous?.systemOverride ?? null)
        : (metadata.systemOverride?.trim() ?? null);
    const input = { ...metadata, title: metadata.title.trim(), systemOverride };
    this.executor.execute(
      'metadata.saveMetadata',
      source,
      relativePath,
      input.title,
      input.description,
      input.released,
      input.developer,
      input.publisher,
      input.genre,
      input.provider,
      input.providerId,
      input.providerSlug,
      input.artworkId,
      systemOverride
    );
    return { source, relativePath, ...input };
  }

  getArtworkId(source: string, relativePath: string): string | null {
    const row = this.executor.findOne<ArtworkRow>('metadata.getArtworkId', source, relativePath);
    return row?.artworkId ?? null;
  }

  /** Update only the system override; preserve other metadata fields. */
  bulkAssignSystem(selection: BulkSystemSelection, value: string | null): number {
    if (
      value !== null &&
      (typeof value !== 'string' || !value.trim() || value.length > 120 || /[\x00-\x1f]/.test(value))
    ) {
      throw new Error('Invalid system assignment.');
    }
    const systemOverride = value?.trim() ?? null;
    return this.executor.transaction(() => {
      let targets: BulkTargetRow[];
      if (selection.scope === 'selected') {
        if (!Array.isArray(selection.targets) || selection.targets.length > 5000) {
          throw new Error('Too many selected ROMs.');
        }
        const keys = new Set<string>();
        targets = [];
        for (const target of selection.targets) {
          if (
            !target ||
            typeof target.source !== 'string' ||
            typeof target.relativePath !== 'string' ||
            target.source.length > 4096 ||
            target.relativePath.length > 4096 ||
            !target.source ||
            !target.relativePath
          ) {
            throw new Error('Invalid ROM target.');
          }
          const key = JSON.stringify([target.source, target.relativePath]);
          if (keys.has(key)) {
            continue;
          }
          keys.add(key);
          const row = this.executor.findOne<BulkTargetRow>(
            'roms.findTarget',
            target.source,
            target.relativePath
          );
          if (!row) {
            throw new Error('Selected ROM no longer exists. Refresh the library.');
          }
          targets.push(row);
        }
      } else if (selection.scope === 'filtered') {
        const q = selection.filter;
        if (
          !q ||
          (q.source !== null && (typeof q.source !== 'string' || q.source.length > 4096)) ||
          typeof q.search !== 'string' ||
          q.search.length > 256 ||
          (q.system !== null && (typeof q.system !== 'string' || q.system.length > 256)) ||
          (q.identification != null &&
            !['pending', 'verified', 'probable', 'ambiguous', 'unknown', 'unsupported', 'error'].includes(
              q.identification
            ))
        ) {
          throw new Error('Invalid bulk filter.');
        }
        const { sql: targetSql, params } = buildBulkTargetsQuery(this.executor, q);
        targets = this.executor.findAll<BulkTargetRow>({ sql: targetSql }, ...params);
        if (targets.length > 250000) {
          throw new Error('Too many matching ROMs; narrow the filter.');
        }
      } else {
        throw new Error('Invalid bulk selection.');
      }
      for (const target of targets) {
        // Clearing does not create unnecessary metadata records.
        if (systemOverride === null) {
          this.executor.execute('metadata.updateSystemOverride', null, target.source, target.relativePath);
        } else {
          this.executor.execute(
            'metadata.insertSystemOverride',
            target.source,
            target.relativePath,
            target.name || 'Untitled',
            systemOverride
          );
        }
      }
      return targets.length;
    });
  }

  getReferencedArtworkIds(): Set<string> {
    const rows = this.executor.findAll<{ id: string }>('metadata.referencedArtwork');
    return new Set(rows.map((row) => row.id));
  }
}

export function createMetadataRepository(
  database: DatabaseConnection
): MetadataRepository & SystemOverrideRepository & ArtworkReferences {
  return new SqliteMetadataRepository(DatabaseConnection.executorFor(database));
}
