import type { LibraryEntry, LibraryPage, LibraryQuery } from '../../shared';

export type ExportLibrary = {
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>
};

export async function readLibraryEntries(library: ExportLibrary, source: string | null): Promise<LibraryEntry[]> {
  const all: LibraryEntry[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await library.queryLibrary({
      source,
      search: '',
      system: null,
      sort: 'name',
      descending: false,
      offset,
      limit: 200
    });
    all.push(...page.items);
    if (all.length >= page.total) {
      return all;
    }
    if (!page.items.length || all.length > 250000) {
      throw new Error('Library changed during export preview.');
    }
  }
}
