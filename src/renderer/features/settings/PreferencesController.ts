import type { AppSettings, DesktopApi, ExportPreferences, LibraryPreferences } from '../../../shared';
import { ControllerState } from '../../controllers/controller-state';

/** Library preferences remain owned by the library controller, not duplicated here. */
function applicationPreferences({ library: _library, ...settings }: AppSettings) {
  return settings;
}

export class PreferencesController extends ControllerState<Omit<AppSettings, 'library'>> {
  constructor(private readonly api: Pick<DesktopApi, 'saveSettings'>, initial: AppSettings, private readonly reportError: (message: string) => void) {
    super(applicationPreferences(initial));
  }

  async persistLibrary(library: LibraryPreferences): Promise<void> {
    try {
      await this.api.saveSettings({ library });
    } catch (reason) {
      this.reportError(`Could not save library preferences: ${String(reason)}`);
    }
  }

  readonly rememberExport = (value: ExportPreferences): void => {
    this.update({ export: value });
    void this.persistExport(value);
  };

  readonly applyPreferences = (next: AppSettings): void => {
    this.update(applicationPreferences(next));
  };

  private async persistExport(value: ExportPreferences): Promise<void> {
    try {
      await this.api.saveSettings({ export: value });
    } catch (reason) {
      this.reportError(`Could not save export preferences: ${String(reason)}`);
    }
  }
}
