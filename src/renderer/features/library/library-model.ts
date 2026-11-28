import type {
  CollectionInfo,
  LibraryEntry,
  LibraryPage,
  LibraryPreferences,
  LibraryQuery,
  SystemCount
} from '../../../shared';

export const PAGE_SIZE = 100;
export const EMPTY_PAGE: LibraryPage = { items: [], total: 0 };

export function collectionPreferences(
  current: LibraryPreferences,
  selected: string | null
): LibraryPreferences {
  return { ...current, selected, system: null, search: '', identification: null };
}

export function samePreferences(left: LibraryPreferences, right: LibraryPreferences): boolean {
  return (
    left.selected === right.selected &&
    left.search === right.search &&
    left.system === right.system &&
    left.sort === right.sort &&
    left.descending === right.descending &&
    left.identification === right.identification &&
    left.view === right.view
  );
}

export function libraryQuery(
  preferences: Pick<LibraryPreferences, 'selected' | 'system' | 'sort' | 'descending' | 'identification'>,
  search: string,
  offset: number
): LibraryQuery {
  return {
    identification: preferences.identification,
    source: preferences.selected,
    search,
    system: preferences.system,
    sort: preferences.sort,
    descending: preferences.descending,
    offset,
    limit: PAGE_SIZE
  };
}

export function collectionSystemSelection(source: string) {
  return { scope: 'filtered' as const, filter: { source, search: '', system: null, identification: null } };
}

export function selectedCollection(
  collections: CollectionInfo[],
  source: string | null
): CollectionInfo | undefined {
  return collections.find((collection) => collection.rootPath === source);
}

export function libraryStatistics(
  collections: CollectionInfo[],
  systems: SystemCount[],
  source: string | null
) {
  const totalGames = collections.reduce((sum, collection) => sum + collection.gameCount, 0);
  const selected = selectedCollection(collections, source);
  const selectedCount = selected?.gameCount ?? totalGames;
  const identified = systems
    .filter((row) => row.system !== 'Needs identification')
    .reduce((sum, row) => sum + row.count, 0);
  return {
    totalGames,
    selectedCount,
    platformTotal: systems.length,
    identifiedPercent: selectedCount ? `${Math.round((identified / selectedCount) * 100)}%` : '—'
  };
}

export function latestDetails(page: LibraryPage, details: LibraryEntry | null): LibraryEntry | null {
  if (!details) {
    return null;
  }
  return (
    page.items.find((item) => item.source === details.source && item.relativePath === details.relativePath) ??
    details
  );
}

export function pagination(total: number, offset: number, limit: number, loading: boolean) {
  const end = Math.min(offset + limit, total);
  return {
    range: total ? `${offset + 1}–${end}` : '0',
    previousOffset: Math.max(0, offset - limit),
    nextOffset: offset + limit,
    previousDisabled: loading || offset === 0,
    nextDisabled: loading || end >= total
  };
}
