import type { LibraryEntry, LibraryPage, LibraryQuery } from '../../shared';

export type ExportLibrary = {
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>
};

const PAGE_SIZE = 200;
const MAX_ENTRIES = 250000;

export async function readLibraryEntries(library: ExportLibrary, source: string | null): Promise<LibraryEntry[]> {
  const all: LibraryEntry[] = [];
  for (;;) {
    const page = await library.queryLibrary({
      source,
      search: '',
      system: null,
      sort: 'name',
      descending: false,
      offset: all.length,
      limit: PAGE_SIZE
    });
    if (page.total > MAX_ENTRIES || all.length + page.items.length > MAX_ENTRIES) {
      throw new Error('Library changed during export preview.');
    }
    all.push(...page.items);
    if (all.length >= page.total) {
      return all;
    }
    if (!page.items.length) {
      throw new Error('Library changed during export preview.');
    }
  }
}
