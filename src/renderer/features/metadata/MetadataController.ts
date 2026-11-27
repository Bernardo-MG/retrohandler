import type {
  DesktopApi, GameMetadataInput, LaunchBoxDownloadProgress, LibraryEntry,
  MetadataCandidate, LibretroCoverChoice, MetadataPreferences
} from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';
import { cleanTitle, initialMetadata, manualMetadata, type MetadataField } from './metadata-model';

type MetadataApi = Pick<DesktopApi,
  'launchBoxSearch' | 'launchBoxApply' | 'downloadLaunchBox' | 'cancelLaunchBoxDownload' |
  'importLaunchBox' | 'searchLibretroCovers' | 'metadataSave' | 'onLaunchBoxProgress'>;
interface MetadataState {
  showArtworkSearch: boolean;
  form: GameMetadataInput;
  systemOverride: string;
  query: string;
  results: MetadataCandidate[];
  imported: string;
  coverQuery: string;
  covers: LibretroCoverChoice[];
  updating: boolean;
  updateProgress: LaunchBoxDownloadProgress | null;
  busy: boolean;
  error: string;
  notice: string;
}

export class MetadataController extends ControllerState<MetadataState> {
  constructor(private readonly api: MetadataApi, entry: LibraryEntry, preferences: MetadataPreferences) {
    super({
      showArtworkSearch: preferences.artwork === 'libretro', form: initialMetadata(entry),
      systemOverride: entry.metadata?.systemOverride ?? '', query: cleanTitle(entry), results: [],
      imported: '', coverQuery: cleanTitle(entry), covers: [], updating: false, updateProgress: null,
      busy: false, error: '', notice: ''
    });
  }

  resetForNewGame(entry: LibraryEntry): void {
    this.update({
      form: initialMetadata(entry), systemOverride: entry.metadata?.systemOverride ?? '',
      query: cleanTitle(entry), coverQuery: cleanTitle(entry), covers: [], results: [], error: '', notice: ''
    });
  }

  connect(): () => void {
    return this.api.onLaunchBoxProgress(updateProgress => this.update({ updateProgress }));
  }

  readonly set = (name: MetadataField, value: string): void => {
    this.update({ form: { ...this.getSnapshot().form, [name]: value } });
  };
  readonly setSystemOverride = (systemOverride: string): void => this.update({ systemOverride });
  readonly setQuery = (query: string): void => this.update({ query });
  readonly setCoverQuery = (coverQuery: string): void => this.update({ coverQuery });
  readonly toggleArtworkSearch = (): void => this.update({ showArtworkSearch: !this.getSnapshot().showArtworkSearch });

  search(entry: LibraryEntry): Promise<void> {
    return this.execute(async () => {
      const { query, systemOverride } = this.getSnapshot();
      this.update({ notice: '', results: [] });
      const results = await this.api.launchBoxSearch(query, systemOverride || entry.system);
      this.update({ results });
    });
  }

  apply(entry: LibraryEntry, id: number, onSaved: () => void): Promise<void> {
    return this.execute(async () => {
      const metadata = await this.api.launchBoxApply(this.target(entry), id);
      this.update({
        form: metadata, systemOverride: metadata.systemOverride ?? this.getSnapshot().systemOverride,
        results: [], notice: 'Metadata matched and saved.'
      });
      onSaved();
    });
  }

  readonly updateLaunchBox = (): Promise<void> => this.execute(async () => {
    this.update({ updating: true, imported: '', updateProgress: null });
    try {
      const result = await this.api.downloadLaunchBox();
      this.update({ imported: `${result.count.toLocaleString()} LaunchBox games downloaded and imported.` });
    } finally {
      this.update({ updating: false });
    }
  });

  readonly cancelLaunchBox = async (): Promise<void> => {
    try {
      await this.api.cancelLaunchBoxDownload();
    } catch (reason) {
      this.update({ error: String(reason) });
    }
  };

  readonly importLaunchBox = (): Promise<void> => this.execute(async () => {
    this.update({ imported: '' });
    const result = await this.api.importLaunchBox();
    if (result) this.update({ imported: `${result.count.toLocaleString()} LaunchBox games imported.` });
  });

  artwork(entry: LibraryEntry, refresh = false): Promise<void> {
    return this.execute(async () => {
      const { systemOverride, coverQuery } = this.getSnapshot();
      this.update({ notice: '', covers: [] });
      const covers = await this.api.searchLibretroCovers(systemOverride.trim() || entry.system, coverQuery.trim(), entry.relativePath, refresh);
      this.update({ covers, notice: covers.length ? '' : 'No downloadable box art matched this title. Try a shorter game title or refresh the catalogue.' });
    });
  }

  readonly selectCover = (artworkId: string): void => {
    this.update({ form: { ...this.getSnapshot().form, artworkId }, notice: 'Cover selected. Click Save manual metadata to keep it.' });
  };

  save(entry: LibraryEntry, onSaved: () => void): Promise<void> {
    return this.execute(async () => {
      const { form, systemOverride } = this.getSnapshot();
      const saved = await this.api.metadataSave(this.target(entry), manualMetadata(form, systemOverride));
      this.update({ form: saved, notice: 'Manual metadata saved.' });
      onSaved();
    });
  }

  private target(entry: LibraryEntry) {
    return { source: entry.source, relativePath: entry.relativePath };
  }

  private async execute(operation: () => Promise<void>): Promise<void> {
    if (this.getSnapshot().busy) return;
    this.update({ busy: true, error: '' });
    try {
      await operation();
    } catch (reason) {
      this.update({ error: String(reason) });
    } finally {
      this.update({ busy: false });
    }
  }
}
