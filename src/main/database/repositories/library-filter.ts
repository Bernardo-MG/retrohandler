import type { LibraryQuery } from '../../../shared';
import type { QueryExecutor } from '../sql/query-executor';

export type LibraryFilter = Pick<LibraryQuery, 'source' | 'system' | 'search' | 'identification'>;

/** All data values are bound parameters. SQL fragments come from the catalog only. */
export function buildFilter(executor: QueryExecutor, filter: LibraryFilter): {
  where: string;
  params: unknown[]
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.source !== null) {
    clauses.push(executor.sql('library.filterSource'));
    params.push(filter.source);
  }
  if (filter.system !== null) {
    clauses.push(executor.sql('library.filterSystem'));
    params.push(filter.system);
  }
  if (filter.search.trim()) {
    clauses.push(executor.sql('library.filterSearch'));
    const pattern = `%${filter.search.trim().replace(/[!%_]/g, (char) => `!${char}`)}%`;
    params.push(pattern, pattern);
  }
  if (filter.identification) {
    if (!['pending', 'verified', 'probable', 'ambiguous', 'unknown', 'unsupported', 'error'].includes(filter.identification)) {
      throw new Error('Invalid identification filter.');
    }
    if (filter.identification === 'pending') {
      clauses.push(executor.sql('library.filterPending'));
    } else {
      clauses.push(executor.sql('library.filterStatus'));
      params.push(filter.identification);
    }
  }

  return { where: clauses.length ? `WHERE ${clauses.join('\n  AND ')}` : '', params };
}
