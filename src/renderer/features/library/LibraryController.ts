import type { CollectionInfo, DesktopApi, LibraryEntry, LibraryPage, LibraryPreferences, LibraryQuery, SystemCount } from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';
import {
  collectionPreferences, collectionSystemSelection, EMPTY_PAGE, libraryQuery, samePreferences, selectedCollection
} from './library-model';

type LibraryApi = Pick<DesktopApi, 'listCollections' | 'listSystems' | 'queryLibrary' | 'bulkAssignSystem' | 'renameCollection' | 'removeCollection'>;
type ReportError = (message: string) => void;
interface LibraryState {
  preferences: LibraryPreferences;
  collections: CollectionInfo[];
  ready: boolean;
  page: LibraryPage;
  systems: SystemCount[];
  offset: number;
  revision: number;
  loading: boolean;
  details: LibraryEntry | null;
  debouncedSearch: string;
}

/** Owns selection, filtering and asynchronous library operations, independent of React. */
export class LibraryController extends ControllerState<LibraryState> {
  private collectionRequest = 0;
  private systemRequest = 0;
  private pageRequest = 0;

  constructor(private readonly api: LibraryApi, initial: LibraryPreferences, private readonly reportError: ReportError) {
    super({
      preferences: initial, collections: [], ready: false, page: EMPTY_PAGE, systems: [],
      offset: 0, revision: 0, loading: true, details: null, debouncedSearch: initial.search
    });
  }

  readonly refresh = (): void => this.update({ revision: this.getSnapshot().revision + 1 });

  readonly reloadCollections = async (): Promise<void> => {
    const request = ++this.collectionRequest;
    const collections = await this.api.listCollections();
    if (request === this.collectionRequest) this.update({ collections, revision: this.getSnapshot().revision + 1 });
  };

  async loadInitialCollections(signal: AbortSignal): Promise<void> {
    const request = ++this.collectionRequest;
    const currentRequest = () => !signal.aborted && request === this.collectionRequest;
    try {
      const collections = await this.api.listCollections();
      if (!currentRequest()) return;
      const { preferences } = this.getSnapshot();
      this.update({ collections });
      if (preferences.selected && !selectedCollection(collections, preferences.selected)) this.selectCollection(null);
    } catch (reason) {
      if (currentRequest()) this.reportError(`Could not load collections: ${String(reason)}`);
    } finally {
      if (currentRequest()) this.update({ ready: true, loading: false });
    }
  }

  async loadSystems(source: string | null, revision: number, signal: AbortSignal): Promise<void> {
    const request = ++this.systemRequest;
    const currentRequest = () => {
      const state = this.getSnapshot();
      return !signal.aborted && request === this.systemRequest && source === state.preferences.selected && revision === state.revision;
    };
    try {
      const systems = await this.api.listSystems(source);
      if (!currentRequest()) return;
      const { preferences } = this.getSnapshot();
      if (preferences.system && !systems.some(row => row.system === preferences.system)) {
        this.update({ systems, preferences: { ...preferences, system: null }, offset: 0, details: null });
      } else {
        this.update({ systems });
      }
    } catch (reason) {
      if (currentRequest()) this.reportError(String(reason));
    }
  }

  async loadPage(signal: AbortSignal): Promise<void> {
    const request = ++this.pageRequest;
    const { revision, preferences, debouncedSearch, offset } = this.getSnapshot();
    const query = libraryQuery(preferences, debouncedSearch, offset);
    const currentRequest = () => {
      const state = this.getSnapshot();
      return !signal.aborted && request === this.pageRequest && revision === state.revision && this.sameQuery(query);
    };
    this.update({ loading: true });
    try {
      const page = await this.api.queryLibrary(query);
      if (currentRequest()) this.update({ page });
    } catch (reason) {
      if (currentRequest()) this.reportError(String(reason));
    } finally {
      if (currentRequest()) this.update({ loading: false });
    }
  }

  private sameQuery(query: LibraryQuery): boolean {
    const { preferences, debouncedSearch, offset } = this.getSnapshot();
    return query.source === preferences.selected && query.system === preferences.system &&
      query.sort === preferences.sort && query.descending === preferences.descending &&
      query.identification === preferences.identification && query.search === debouncedSearch && query.offset === offset;
  }

  readonly selectCollection = (source: string | null): void => {
    this.update({ preferences: collectionPreferences(this.getSnapshot().preferences, source), debouncedSearch: '', offset: 0, details: null });
  };

  private updateFilter(patch: Partial<LibraryPreferences>, closeDetails = true): void {
    const { preferences, details, offset } = this.getSnapshot();
    this.update({ preferences: { ...preferences, ...patch }, offset: 0, details: closeDetails || offset !== 0 ? null : details });
  }

  readonly filterSearch = (value: string): void => this.updateFilter({ search: value.slice(0, 256) }, false);
  readonly filterSystem = (system: string | null): void => this.updateFilter({ system });
  readonly filterSort = (sort: LibraryPreferences['sort']): void => this.updateFilter({ sort });
  readonly filterDescending = (descending: boolean): void => this.updateFilter({ descending });
  readonly filterIdentification = (identification: LibraryPreferences['identification']): void => this.updateFilter({ identification });
  readonly setView = (view: LibraryPreferences['view']): void => {
    this.update({ preferences: { ...this.getSnapshot().preferences, view } });
  };
  readonly applyPreferences = (preferences: LibraryPreferences): void => {
    if (!samePreferences(preferences, this.getSnapshot().preferences)) {
      this.update({ preferences, debouncedSearch: preferences.search, offset: 0, details: null });
    }
  };
  readonly setOffset = (offset: number): void => {
    if (offset !== this.getSnapshot().offset) this.update({ offset, details: null });
  };
  readonly setDetails = (details: LibraryEntry | null): void => this.update({ details });
  readonly closeDetails = (): void => this.setDetails(null);

  setDebouncedSearch(debouncedSearch: string): void {
    if (debouncedSearch === this.getSnapshot().preferences.search && debouncedSearch !== this.getSnapshot().debouncedSearch) {
      this.update({ debouncedSearch, details: null });
    }
  }

  readonly assignCollectionSystem = async (source: string, systemOverride: string | null): Promise<number> => {
    const updated = await this.api.bulkAssignSystem(collectionSystemSelection(source), systemOverride);
    await this.reloadCollections();
    return updated;
  };
  readonly rename = async (source: string, label: string): Promise<void> => {
    try {
      await this.api.renameCollection(source, label);
      await this.reloadCollections();
    } catch (reason) {
      this.reportError(String(reason));
    }
  };
  readonly remove = async (source: string): Promise<void> => {
    try {
      await this.api.removeCollection(source);
      if (this.getSnapshot().preferences.selected === source) this.selectCollection(null);
      await this.reloadCollections();
    } catch (reason) {
      this.reportError(String(reason));
    }
  };
}
