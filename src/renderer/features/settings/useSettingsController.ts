import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppSettings, CollectionInfo, LibraryPreferences, SettingsPatch, StorageInfo } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { formatSize } from '../../utils/format-size';

export interface SettingsPanelProps {
  settings: AppSettings;
  collections: CollectionInfo[];
  onClose(): void;
  onSaved(settings: AppSettings): void;
}
export function useSettingsController({ settings, collections, onClose, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState(settings);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const panel = useRef<HTMLElement>(null);

  useEffect(
    () => {
      panel.current?.focus();
      let mounted = true;
      void desktopApi().getStorageInfo().then(value => {
        if (mounted) {
          setStorage(value);
        }
      })
        .catch(reason => {
          if (mounted) {
            setStorageError(String(reason));
          }
        })
        .finally(() => {
          if (mounted) {
            setStorageLoading(false);
          }
        });
      return () => {
        mounted = false;
      };
    },
    []
  );

  const updateLibrary = (patch: Partial<LibraryPreferences>) => setDraft(current => ({ ...current, library: { ...current.library, ...patch } }));
  const changeCollection = (selected: string | null) => updateLibrary({
    selected,
    system: null,
    search: '',
    identification: null
  });
  const clearFilters = () => updateLibrary({ system: null, search: '', identification: null });

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) {
      return;
    }
    const controls = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter(control => control.getClientRects().length > 0);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
      event.preventDefault();
      first.focus();
    }
  }
  async function chooseDestination() {
    setBusy(true);
    setError('');
    try {
      const destination = await desktopApi().chooseExportFolder();
      if (destination) {
        setDraft(current => ({ ...current, export: { ...current.export, destination } }));
      }
    } catch (reason) {
      setError(String(reason));
    }
    finally {
      setBusy(false);
    }
  }
  function removeMapping(system: string) {
    setDraft(current => {
      const overrides = { ...current.export.overrides };
      delete overrides[system];
      return { ...current, export: { ...current.export, overrides } };
    });
  }
  async function refreshStorage() {
    setStorageLoading(true);
    setStorageError('');
    try {
      setStorage(await desktopApi().getStorageInfo());
    }
    catch (reason) {
      setStorage(null);
      setStorageError(String(reason));
    }
    finally {
      setStorageLoading(false);
    }
  }
  async function cleanup() {
    setBusy(true);
    setStorageError('');
    setNotice('');
    try {
      const receipt = await desktopApi().cleanupArtworkCache();
      setNotice(receipt.removedFiles || receipt.failedFiles
        ? `${receipt.removedFiles} files removed (${formatSize(receipt.removedBytes)} reclaimed).${receipt.failedFiles ? ` ${receipt.failedFiles} files could not be removed.` : ''}`
        : 'No files removed.');
      await refreshStorage();
    } catch (reason) {
      setStorageError(String(reason));
    }
    finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const patch: SettingsPatch = {
        library: draft.library,
        appearance: draft.appearance,
        export: draft.export,
        metadata: draft.metadata
      };
      onSaved(await desktopApi().saveSettings(patch));
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    setError('');
    try {
      onSaved(await desktopApi().resetSettings());
    }
    catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  }

  function changeTheme(theme: AppSettings['appearance']['theme']) {
    setDraft(current => ({ ...current, appearance: { theme } }));
  }
  function clearDestination() {
    setDraft(current => ({ ...current, export: { ...current.export, destination: '' } }));
  }
  function changeArtwork(includeArtwork: boolean) {
    setDraft(current => ({ ...current, export: { ...current.export, includeArtwork } }));
  }
  function clearMappings() {
    setDraft(current => ({ ...current, export: { ...current.export, overrides: {} } }));
  }
  function changeMetadataStart(startWith: AppSettings['metadata']['startWith']) {
    setDraft(current => ({ ...current, metadata: { ...current.metadata, startWith } }));
  }
  function changeMetadataArtwork(artwork: AppSettings['metadata']['artwork']) {
    setDraft(current => ({ ...current, metadata: { ...current.metadata, artwork } }));
  }
  function requestReset() { setConfirmReset(true); }
  function cancelReset() { setConfirmReset(false); }

  return {
    draft, collections, onClose, storage, storageLoading, storageError, notice, error, busy, confirmReset, panel,
    mappings: Object.entries(draft.export.overrides).sort(([a], [b]) => a.localeCompare(b)),
    updateLibrary, changeCollection, clearFilters, keyDown, chooseDestination, removeMapping,
    refreshStorage, cleanup, save, reset, changeTheme, clearDestination, changeArtwork, clearMappings,
    changeMetadataStart, changeMetadataArtwork, requestReset, cancelReset
  };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
