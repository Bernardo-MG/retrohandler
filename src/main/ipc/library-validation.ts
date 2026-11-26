import type { BulkSystemSelection, LibraryQuery } from '../../shared';
import { isOneOf, isRecord, isText } from './validation';

const IDENTIFICATION_STATUSES = ['pending', 'verified', 'probable', 'ambiguous', 'unknown', 'unsupported', 'error'] as const;
const SORTS = ['name', 'system', 'bytes'] as const;

function isNullableText(value: unknown, limit: number): value is string | null {
  return value === null || isText(value, limit);
}

type LibraryFilter = Pick<LibraryQuery, 'source' | 'search' | 'system' | 'identification'>;

function isFilter(value: unknown): value is Record<string, unknown> & LibraryFilter {
  if (!isRecord(value)) {
    return false;
  }
  return isNullableText(value.source, 4096) && isText(value.search, 256) &&
    isNullableText(value.system, 256) &&
    (value.identification === undefined || value.identification === null || isOneOf(value.identification, IDENTIFICATION_STATUSES));
}

export function parseLibraryQuery(value: unknown): LibraryQuery {
  if (!isRecord(value) || !isFilter(value) || !isOneOf(value.sort, SORTS) ||
    typeof value.descending !== 'boolean' || !isIntegerInRange(value.offset, 0, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(value.limit, 1, 200)) {
    throw new Error('Invalid library query.');
  }
  return {
    source: value.source,
    search: value.search,
    system: value.system,
    identification: value.identification,
    sort: value.sort,
    descending: value.descending,
    offset: value.offset,
    limit: value.limit
  };
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isTarget(value: unknown): value is { source: string; relativePath: string } {
  return isRecord(value) && isText(value.source, 4096) && isText(value.relativePath, 4096) &&
    value.source.length > 0 && value.relativePath.length > 0 &&
    !value.source.includes('\0') && !value.relativePath.includes('\0');
}

function parseTargets(values: unknown[]): Array<{ source: string; relativePath: string }> {
  if (values.length > 5000) {
    throw new Error('Too many selected ROMs.');
  }
  const targets: Array<{ source: string; relativePath: string }> = [];
  for (const value of values) {
    if (!isTarget(value)) {
      throw new Error('Invalid bulk selection.');
    }
    targets.push({ source: value.source, relativePath: value.relativePath });
  }
  return targets;
}

export function parseBulkSelection(value: unknown): BulkSystemSelection {
  if (isRecord(value)) {
    if (value.scope === 'selected' && Array.isArray(value.targets)) {
      return { scope: 'selected', targets: parseTargets(value.targets) };
    }
    if (value.scope === 'filtered' && isFilter(value.filter)) {
      return { scope: 'filtered', filter: value.filter };
    }
  }
  throw new Error('Invalid bulk selection.');
}

export function parseSystemOverride(value: unknown): string | null {
  if (value === null || (isText(value, 120) && value.trim() && !/[\x00-\x1f]/.test(value))) {
    return value;
  }
  throw new Error('Invalid system.');
}

export function parseCollection(value: unknown): string {
  if (!isText(value, 4096)) {
    throw new Error('Invalid collection.');
  }
  return value;
}
