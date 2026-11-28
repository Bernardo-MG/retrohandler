import { useEffect } from 'react';
import type { AppSettings, LibraryPreferences } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { watchTheme } from '../../app/theme';
import { useControllerState } from '../../hooks/useControllerState';
import { PreferencesController } from './PreferencesController';

export function usePreferences(
  initial: AppSettings,
  library: LibraryPreferences,
  ready: boolean,
  reportError: (message: string) => void
) {
  const [controller, preferences] = useControllerState(
    () => new PreferencesController(desktopApi(), initial, reportError)
  );
  useEffect(
    function persistLibraryPreferences() {
      if (ready) {
        void controller.persistLibrary(library);
      }
    },
    [controller, ready, library]
  );

  useEffect(
    function synchronizeTheme() {
      return watchTheme(preferences.appearance.theme);
    },
    [preferences.appearance.theme]
  );

  return {
    settings: { ...preferences, library },
    rememberExport: controller.rememberExport,
    applyPreferences: controller.applyPreferences
  };
}
