import { useCallback, useEffect, useState } from 'react';
import type { CollectionInfo, LibraryEntry, LibraryPage, LibraryPreferences, SystemCount } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import {
  collectionPreferences, collectionSystemSelection, EMPTY_PAGE, latestDetails, libraryQuery,
  libraryStatistics, samePreferences, selectedCollection
} from './library-model';

/** Owns the library selection, query and refresh lifecycle. No rendering. */
export function useLibraryController(initial: LibraryPreferences, reportError: (message: string) => void) {
  const [preferences, setPreferences] = useState(initial);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<LibraryPage>(EMPTY_PAGE);
  const [systems, setSystems] = useState<SystemCount[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<LibraryEntry | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(initial.search);
  const { selected, search, system, sort, descending, identification } = preferences;

  const refresh = useCallback(function refresh() {
    setRevision(value => value + 1);
  }, []);

  async function reloadCollections() {
    setCollections(await desktopApi().listCollections());
    refresh();
  }

  useEffect(function loadInitialCollections() {
    let active = true;
    async function load() {
      try {
        const found = await desktopApi().listCollections();
        if (!active) return;
        setCollections(found);
        if (initial.selected && !selectedCollection(found, initial.selected)) {
          setPreferences(current => collectionPreferences(current, null));
          setDebouncedSearch('');
        }
      } catch (reason) {
        if (active) reportError(`Could not load collections: ${String(reason)}`);
      } finally {
        if (active) {
          setReady(true);
          setLoading(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [initial, reportError]);

  useEffect(function loadSystems() {
    if (!ready) return;
    let active = true;
    async function load() {
      try {
        const found = await desktopApi().listSystems(selected);
        if (!active) return;
        setSystems(found);
        setPreferences(current => current.system && !found.some(row => row.system === current.system)
          ? { ...current, system: null } : current);
      } catch (reason) {
        if (active) reportError(String(reason));
      }
    }
    void load();
    return () => { active = false; };
  }, [ready, selected, revision, reportError]);

  useEffect(function debounceSearch() {
    const timeout = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(function loadLibraryPage() {
    if (!ready) return;
    let active = true;
    setLoading(true);
    // Use only query fields as dependencies: switching list/gallery is presentation only.
    const query = libraryQuery({ selected, system, sort, descending, identification }, debouncedSearch, offset);
    async function load() {
      try {
        const found = await desktopApi().queryLibrary(query);
        if (active) setPage(found);
      } catch (reason) {
        if (active) reportError(String(reason));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [ready, selected, debouncedSearch, system, sort, descending, identification, offset, revision, reportError]);

  useEffect(function closeStaleDetails() {
    setDetails(null);
  }, [selected, offset, system, sort, descending, debouncedSearch, identification]);

  function selectCollection(source: string | null) {
    setPreferences(current => collectionPreferences(current, source));
    setDebouncedSearch('');
    setOffset(0);
    setDetails(null);
  }

  function updateFilter(patch: Partial<LibraryPreferences>) {
    setPreferences(current => ({ ...current, ...patch }));
    setOffset(0);
  }

  function filterSearch(value: string) {
    updateFilter({ search: value.slice(0, 256) });
  }
  function filterSystem(value: string | null) {
    updateFilter({ system: value });
  }
  function filterSort(value: LibraryPreferences['sort']) {
    updateFilter({ sort: value });
  }
  function filterDescending(value: boolean) {
    updateFilter({ descending: value });
  }
  function filterIdentification(value: LibraryPreferences['identification']) {
    updateFilter({ identification: value });
  }
  function setView(view: LibraryPreferences['view']) {
    setPreferences(current => ({ ...current, view }));
  }
  function applyPreferences(next: LibraryPreferences) {
    if (samePreferences(next, preferences)) return;
    setPreferences(next);
    setDebouncedSearch(next.search);
    setOffset(0);
    setDetails(null);
  }
  function closeDetails() {
    setDetails(null);
  }

  async function assignCollectionSystem(source: string, systemOverride: string | null): Promise<number> {
    const updated = await desktopApi().bulkAssignSystem(collectionSystemSelection(source), systemOverride);
    await reloadCollections();
    return updated;
  }
  async function rename(source: string, label: string) {
    try {
      await desktopApi().renameCollection(source, label);
      await reloadCollections();
    } catch (reason) {
      reportError(String(reason));
    }
  }
  async function remove(source: string) {
    try {
      await desktopApi().removeCollection(source);
      if (selected === source) selectCollection(null);
      await reloadCollections();
    } catch (reason) {
      reportError(String(reason));
    }
  }

  return {
    preferences, collections, ready, page, systems, offset, loading,
    details: latestDetails(page, details), selectedInfo: selectedCollection(collections, selected),
    statistics: libraryStatistics(collections, systems, selected),
    selectCollection, filterSearch, filterSystem, filterSort, filterDescending, filterIdentification,
    setView, applyPreferences, setOffset, setDetails, closeDetails, refresh, reloadCollections,
    rename, remove, assignCollectionSystem
  };
}

export type LibraryController = ReturnType<typeof useLibraryController>;
