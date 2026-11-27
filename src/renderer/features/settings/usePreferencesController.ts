import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, ExportPreferences, LibraryPreferences } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { watchTheme } from '../../app/theme';

/** Library preferences remain owned by the library controller, not duplicated here. */
function applicationPreferences({ library: _library, ...settings }: AppSettings) {
  return settings;
}

export function usePreferencesController(initial: AppSettings, library: LibraryPreferences, ready: boolean, reportError: (message: string) => void) {
  const [preferences, setPreferences] = useState(() => applicationPreferences(initial));
  useEffect(function persistLibraryPreferences() {
    if (!ready) return;
    void desktopApi().saveSettings({ library })
      .catch(reason => reportError(`Could not save library preferences: ${String(reason)}`));
  }, [ready, library, reportError]);

  useEffect(function synchronizeTheme() {
    return watchTheme(preferences.appearance.theme);
  }, [preferences.appearance.theme]);

  const rememberExport = useCallback(function rememberExport(value: ExportPreferences) {
    setPreferences(current => ({ ...current, export: value }));
    void desktopApi().saveSettings({ export: value })
      .catch(reason => reportError(`Could not save export preferences: ${String(reason)}`));
  }, [reportError]);

  function applyPreferences(next: AppSettings) {
    setPreferences(applicationPreferences(next));
  }

  return { settings: { ...preferences, library }, rememberExport, applyPreferences };
}
