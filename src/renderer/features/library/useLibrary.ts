import { useEffect } from 'react';
import type { LibraryPreferences } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { useControllerState } from '../../hooks/useControllerState';
import { LibraryController } from './LibraryController';
import { latestDetails, libraryStatistics, selectedCollection } from './library-model';

export function useLibrary(initial: LibraryPreferences, reportError: (message: string) => void) {
  const [controller, state] = useControllerState(
    () => new LibraryController(desktopApi(), initial, reportError)
  );
  const {
    preferences,
    collections,
    ready,
    page,
    systems,
    offset,
    loading,
    details,
    debouncedSearch,
    revision
  } = state;
  const { selected, search, system, sort, descending, identification } = preferences;

  useEffect(
    function loadInitialCollections() {
      const request = new AbortController();
      void controller.loadInitialCollections(request.signal);
      return () => request.abort();
    },
    [controller]
  );

  useEffect(
    function loadSystems() {
      if (!ready) {
        return;
      }
      const request = new AbortController();
      void controller.loadSystems(selected, revision, request.signal);
      return () => request.abort();
    },
    [controller, ready, selected, revision]
  );

  useEffect(
    function debounceSearch() {
      const timeout = setTimeout(() => controller.setDebouncedSearch(search), 200);
      return () => clearTimeout(timeout);
    },
    [controller, search]
  );

  useEffect(
    function loadLibraryPage() {
      if (!ready) {
        return;
      }
      const request = new AbortController();
      void controller.loadPage(request.signal);
      return () => request.abort();
    },
    [controller, ready, selected, debouncedSearch, system, sort, descending, identification, offset, revision]
  );

  return {
    preferences,
    collections,
    ready,
    page,
    systems,
    offset,
    loading,
    details: latestDetails(page, details),
    selectedInfo: selectedCollection(collections, selected),
    statistics: libraryStatistics(collections, systems, selected),
    selectCollection: controller.selectCollection,
    filterSearch: controller.filterSearch,
    filterSystem: controller.filterSystem,
    filterSort: controller.filterSort,
    filterDescending: controller.filterDescending,
    filterIdentification: controller.filterIdentification,
    setView: controller.setView,
    applyPreferences: controller.applyPreferences,
    setOffset: controller.setOffset,
    setDetails: controller.setDetails,
    closeDetails: controller.closeDetails,
    refresh: controller.refresh,
    reloadCollections: controller.reloadCollections,
    rename: controller.rename,
    remove: controller.remove,
    assignCollectionSystem: controller.assignCollectionSystem
  };
}

export type LibraryViewModel = ReturnType<typeof useLibrary>;
