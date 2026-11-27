import { useRef, useState } from 'react';
import type { AppSettings, ScanReceipt, SettingsSnapshot } from '../../shared';
import { useIdentificationController } from '../features/identification/useIdentificationController';
import { useLibraryController } from '../features/library/useLibraryController';
import { useScanController } from '../features/scanner/useScanController';
import { usePreferencesController } from '../features/settings/usePreferencesController';

/** Composes independent feature workflows and owns only application-level UI state. */
export function useAppController(initial: SettingsSnapshot) {
  const [error, setError] = useState(initial.warning ?? '');
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const library = useLibraryController(initial.settings.library, setError);
  const preferences = usePreferencesController(initial.settings, library.preferences, library.ready, setError);
  const scanner = useScanController(scanCompleted, setError);
  const identification = useIdentificationController(library.preferences.selected, library.refresh, setError);

  async function scanCompleted(receipt: ScanReceipt) {
    await library.reloadCollections();
    library.selectCollection(receipt.source);
  }
  function openSettings() { setShowSettings(true); }
  function closeSettings() {
    setShowSettings(false);
    requestAnimationFrame(() => settingsButton.current?.focus());
  }
  function saveSettings(next: AppSettings) {
    preferences.applyPreferences(next);
    library.applyPreferences(next.library);
    closeSettings();
  }
  function openExport() { setShowExport(true); }
  function closeExport() { setShowExport(false); }
  function dismissError() { setError(''); }

  return {
    library, preferences, scanner, identification, error, dismissError,
    settingsButton, showSettings, openSettings, closeSettings, saveSettings,
    showExport, openExport, closeExport
  };
}

export type AppController = ReturnType<typeof useAppController>;
