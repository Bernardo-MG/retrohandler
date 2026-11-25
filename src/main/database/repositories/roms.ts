import type { LibraryPage, LibraryQuery, SystemCount } from '../../../shared';
import type { RomRepository } from '../../contracts/persistence';
import { DatabaseConnection } from '../database-connection';
import { QueryExecutor } from '../sql/query-executor';
import type { LibraryRow } from '../types';
import { buildFilter } from './library-filter';

const SORT_COLUMNS = {
  name: 'library.sortName',
  system: 'library.sortSystem',
  bytes: 'library.sortBytes'
} as const;

function buildLibraryQueries(executor: QueryExecutor, query: LibraryQuery) {
  if (!Object.hasOwn(SORT_COLUMNS, query.sort)) {
    throw new Error('Invalid sort order.');
  }
  const { where, params } = buildFilter(executor, query);
  return {
    countSql: executor.render('library.countGames', { where }),
    pageSql: executor.render(
      'library.pageGames',
      {
        where,
        order: executor.sql(SORT_COLUMNS[query.sort]),
        direction: query.descending ? 'DESC' : 'ASC'
      }
    ),
    params
  };
}

function buildSystemsQuery(executor: QueryExecutor, source: string | null): string {
  return executor.render(
    'library.listSystems',
    {
      where: source === null ? '' : `WHERE ${executor.sql('library.filterSource')}`
    }
  );
}

export class SqliteRomRepository implements RomRepository {
  constructor(private readonly executor: QueryExecutor) {}

  queryLibrary(query: LibraryQuery): LibraryPage {
    if (!Number.isSafeInteger(query.offset) || query.offset < 0 ||
      !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200) {
      throw new Error('Invalid library page.');
    }
    const { countSql, pageSql, params } = buildLibraryQueries(this.executor, query);
    const count = this.executor.findRequired<{ total: number }>({ sql: countSql }, ...params);
    const rows = this.executor.findAll<LibraryRow>({ sql: pageSql }, ...params, query.limit, query.offset);
    return {
      items: rows.map(row => ({
        source: row.source,
        id: row.id,
        name: row.name,
        system: row.system,
        relativePath: row.relativePath,
        extension: row.extension,
        bytes: row.bytes,
        identificationStatus: row.identificationStatus ?? 'pending',
        identifiedTitle: row.identifiedTitle,
        datName: row.datName,
        metadata: row.metadataProvider ? {
          source: row.source,
          relativePath: row.relativePath,
          title: row.metadataTitle ?? '',
          description: row.metadataDescription ?? '',
          released: row.metadataReleased ?? '',
          developer: row.metadataDeveloper ?? '',
          publisher: row.metadataPublisher ?? '',
          genre: row.metadataGenre ?? '',
          provider: row.metadataProvider,
          providerId: row.metadataProviderId,
          providerSlug: row.metadataProviderSlug,
          artworkId: row.metadataArtworkId,
          systemOverride: row.metadataSystemOverride
        } : null
      })),
      total: count.total
    };
  }

  listSystems(source: string | null): SystemCount[] {
    const parameters = source === null ? [] : [source];
    return this.executor.findAll<SystemCount>({ sql: buildSystemsQuery(this.executor, source) }, ...parameters);
  }
}

export function createRomRepository(database: DatabaseConnection): RomRepository {
  return new SqliteRomRepository(DatabaseConnection.executorFor(database));
}
