import type { LibraryQuery } from '../../shared';
import { renderQuery, sql } from './query-loader';

type LibraryFilter = Pick<LibraryQuery, 'source' | 'system' | 'search' | 'identification'>;

const SORT_COLUMNS = {
  name: 'library.sortName',
  system: 'library.sortSystem',
  bytes: 'library.sortBytes'
} as const;

/** All data values are bound parameters. SQL fragments come from the catalog only. */
function buildFilter(filter: LibraryFilter): {
  where: string;
  params: unknown[]
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.source !== null) {
    clauses.push(sql('library.filterSource'));
    params.push(filter.source);
  }
  if (filter.system !== null) {
    clauses.push(sql('library.filterSystem'));
    params.push(filter.system);
  }
  if (filter.search.trim()) {
    clauses.push(sql('library.filterSearch'));
    const pattern = `%${filter.search.trim().replace(/[!%_]/g, (char) => `!${char}`)}%`;
    params.push(pattern, pattern);
  }
  if (filter.identification) {
    if (!['pending', 'verified', 'probable', 'ambiguous', 'unknown', 'unsupported', 'error'].includes(filter.identification)) {
      throw new Error('Invalid identification filter.');
    }
    if (filter.identification === 'pending') {
      clauses.push(sql('library.filterPending'));
    } else {
      clauses.push(sql('library.filterStatus'));
      params.push(filter.identification);
    }
  }

  return { where: clauses.length ? `WHERE ${clauses.join('\n  AND ')}` : '', params };
}

export function buildLibraryQueries(query: LibraryQuery) {
  if (!Object.hasOwn(SORT_COLUMNS, query.sort)) {
    throw new Error('Invalid sort order.');
  }
  const { where, params } = buildFilter(query);
  return {
    countSql: renderQuery('library.countGames', { where }),
    pageSql: renderQuery(
      'library.pageGames',
      {
        where,
        order: sql(SORT_COLUMNS[query.sort]),
        direction: query.descending ? 'DESC' : 'ASC'
      }
    ),
    params
  };
}

export function buildBulkTargetsQuery(filter: LibraryFilter) {
  const { where, params } = buildFilter(filter);
  return { sql: renderQuery('library.bulkTargets', { where }), params };
}

export function buildSystemsQuery(source: string | null): string {
  return renderQuery(
    'library.listSystems',
    {
      where: source === null ? '' : `WHERE ${sql('library.filterSource')}`
    }
  );
}
