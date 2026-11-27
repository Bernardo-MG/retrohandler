import type {
  AppSettings,
  DesktopApi,
  LibraryPreferences,
  SettingsPatch,
  StorageInfo
} from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';
import { formatSize } from '../../utils/format-size';

type SettingsApi = Pick<
  DesktopApi,
  'getStorageInfo' | 'chooseExportFolder' | 'cleanupArtworkCache' | 'saveSettings' | 'resetSettings'
>;
interface SettingsState {
  draft: AppSettings;
  storage: StorageInfo | null;
  storageLoading: boolean;
  storageError: string;
  notice: string;
  error: string;
  busy: boolean;
  confirmReset: boolean;
}

export class SettingsController extends ControllerState<SettingsState> {
  private storageRequest = 0;

  constructor(
    private readonly api: SettingsApi,
    settings: AppSettings
  ) {
    super({
      draft: settings,
      storage: null,
      storageLoading: true,
      storageError: '',
      notice: '',
      error: '',
      busy: false,
      confirmReset: false
    });
  }

  private changeDraft(patch: Partial<AppSettings>): void {
    this.update({ draft: { ...this.getSnapshot().draft, ...patch } });
  }
  public readonly updateLibrary = (patch: Partial<LibraryPreferences>): void => {
    this.changeDraft({ library: { ...this.getSnapshot().draft.library, ...patch } });
  };
  public readonly changeCollection = (selected: string | null): void =>
    this.updateLibrary({ selected, system: null, search: '', identification: null });
  public readonly clearFilters = (): void =>
    this.updateLibrary({ system: null, search: '', identification: null });

  public readonly changeTheme = (theme: AppSettings['appearance']['theme']): void =>
    this.changeDraft({ appearance: { theme } });
  private updateExport(patch: Partial<AppSettings['export']>): void {
    this.changeDraft({ export: { ...this.getSnapshot().draft.export, ...patch } });
  }
  public readonly clearDestination = (): void => this.updateExport({ destination: '' });
  public readonly changeArtwork = (includeArtwork: boolean): void => this.updateExport({ includeArtwork });
  public readonly clearMappings = (): void => this.updateExport({ overrides: {} });
  public readonly removeMapping = (system: string): void => {
    const overrides = { ...this.getSnapshot().draft.export.overrides };
    delete overrides[system];
    this.updateExport({ overrides });
  };
  public readonly changeMetadataStart = (startWith: AppSettings['metadata']['startWith']): void => {
    this.changeDraft({ metadata: { ...this.getSnapshot().draft.metadata, startWith } });
  };
  public readonly changeMetadataArtwork = (artwork: AppSettings['metadata']['artwork']): void => {
    this.changeDraft({ metadata: { ...this.getSnapshot().draft.metadata, artwork } });
  };
  public readonly requestReset = (): void => this.update({ confirmReset: true });
  public readonly cancelReset = (): void => this.update({ confirmReset: false });

  public readonly chooseDestination = async (): Promise<void> => {
    if (this.getSnapshot().busy) {
      return;
    }
    this.update({ busy: true, error: '' });
    try {
      const destination = await this.api.chooseExportFolder();
      if (destination) this.updateExport({ destination });
    } catch (reason) {
      this.update({ error: String(reason) });
    } finally {
      this.update({ busy: false });
    }
  };

  public readonly refreshStorage = async (signal?: AbortSignal): Promise<void> => {
    const request = ++this.storageRequest;
    const currentRequest = () => !signal?.aborted && request === this.storageRequest;
    this.update({ storageLoading: true, storageError: '' });
    try {
      const storage = await this.api.getStorageInfo();
      if (currentRequest()) this.update({ storage });
    } catch (reason) {
      if (currentRequest()) this.update({ storage: null, storageError: String(reason) });
    } finally {
      if (currentRequest()) this.update({ storageLoading: false });
    }
  };

  public readonly cleanup = async (): Promise<void> => {
    if (this.getSnapshot().busy) {
      return;
    }
    this.update({ busy: true, storageError: '', notice: '' });
    try {
      const receipt = await this.api.cleanupArtworkCache();
      this.update({
        notice:
          receipt.removedFiles || receipt.failedFiles
            ? `${receipt.removedFiles} files removed (${formatSize(receipt.removedBytes)} reclaimed).${receipt.failedFiles ? ` ${receipt.failedFiles} files could not be removed.` : ''}`
            : 'No files removed.'
      });
      await this.refreshStorage();
    } catch (reason) {
      this.update({ storageError: String(reason) });
    } finally {
      this.update({ busy: false });
    }
  };

  public save(onSaved: (settings: AppSettings) => void): Promise<void> {
    const { library, appearance, export: exportPreferences, metadata } = this.getSnapshot().draft;
    const patch: SettingsPatch = { library, appearance, export: exportPreferences, metadata };
    return this.persist(() => this.api.saveSettings(patch), onSaved);
  }

  public reset(onSaved: (settings: AppSettings) => void): Promise<void> {
    return this.persist(() => this.api.resetSettings(), onSaved);
  }

  private async persist(
    operation: () => Promise<AppSettings>,
    onSaved: (settings: AppSettings) => void
  ): Promise<void> {
    if (this.getSnapshot().busy) {
      return;
    }
    this.update({ busy: true, error: '' });
    try {
      onSaved(await operation());
      // The dialog closes on success; keep it disabled until the view unmounts.
    } catch (reason) {
      this.update({ error: String(reason), busy: false });
    }
  }
}
