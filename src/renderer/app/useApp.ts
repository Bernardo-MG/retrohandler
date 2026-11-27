import { useRef, useState } from 'react';
import type { AppSettings, ScanReceipt, SettingsSnapshot } from '../../shared';
import { useIdentification } from '../features/identification/useIdentification';
import { useLibrary } from '../features/library/useLibrary';
import { useScan } from '../features/scanner/useScan';
import { usePreferences } from '../features/settings/usePreferences';

/** Composes independent feature workflows and owns only application-level UI state. */
export function useApp(initial: SettingsSnapshot) {
  const [error, setError] = useState(initial.warning ?? '');
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const library = useLibrary(initial.settings.library, setError);
  const preferences = usePreferences(initial.settings, library.preferences, library.ready, setError);
  const scanner = useScan(scanCompleted, setError);
  const identification = useIdentification(library.preferences.selected, library.refresh, setError);

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

export type AppViewModel = ReturnType<typeof useApp>;
