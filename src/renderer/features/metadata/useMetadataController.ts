import { useEffect, useRef, useState } from 'react';
import type { GameMetadataInput, LaunchBoxDownloadProgress, LibraryEntry, MetadataCandidate, MetadataTarget, LibretroCoverChoice, MetadataPreferences } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { cleanTitle, initialMetadata, launchBoxProgress, manualMetadata, type MetadataField } from './metadata-model';

export interface MetadataPanelProps {
  entry: LibraryEntry;
  onClose(): void;
  onSaved(): void;
  preferences: MetadataPreferences;
}

export function useMetadataController({ entry, onClose, onSaved, preferences }: MetadataPanelProps) {
  const [showArtworkSearch, setShowArtworkSearch] = useState(preferences.artwork === 'libretro');
  const [form, setForm] = useState<GameMetadataInput>(() => initialMetadata(entry));
  const [systemOverride, setSystemOverride] = useState(entry.metadata?.systemOverride ?? '');
  const [query, setQuery] = useState(() => cleanTitle(entry));
  const [results, setResults] = useState<MetadataCandidate[]>([]);
  const [imported, setImported] = useState('');
  const [coverQuery, setCoverQuery] = useState(() => cleanTitle(entry));
  const [covers, setCovers] = useState<LibretroCoverChoice[]>([]);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<LaunchBoxDownloadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const target: MetadataTarget = { source: entry.source, relativePath: entry.relativePath };

  // A new game is mounted with a new key by the library view; refreshes of the
  // same game must not discard unsaved form edits.
  useEffect(function resetForNewGame() {
    setForm(initialMetadata(entry));
    setSystemOverride(entry.metadata?.systemOverride ?? '');
    setQuery(cleanTitle(entry));
    setCoverQuery(cleanTitle(entry));
    setCovers([]);
    setResults([]);
    setError('');
    setNotice('');
  }, [entry.source, entry.relativePath]);

  useEffect(function subscribeToProgress() {
    return desktopApi().onLaunchBoxProgress(setUpdateProgress);
  }, []);

  useEffect(function handleEscape() {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function set(name: MetadataField, value: string) {
    setForm(old => ({ ...old, [name]: value }));
  }
  function toggleArtworkSearch() {
    setShowArtworkSearch(value => !value);
  }

  async function execute(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      setError(String(reason));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  function search() {
    return execute(async function searchCatalogue() {
      setNotice('');
      setResults([]);
      setResults(await desktopApi().launchBoxSearch(query, systemOverride || entry.system));
    });
  }
  function apply(id: number) {
    return execute(async function applyMatch() {
      const metadata = await desktopApi().launchBoxApply(target, id);
      setForm(metadata);
      setSystemOverride(metadata.systemOverride ?? systemOverride);
      setResults([]);
      setNotice('Metadata matched and saved.');
      onSaved();
    });
  }
  function updateLaunchBox() {
    return execute(async function downloadCatalogue() {
      setUpdating(true);
      setImported('');
      setUpdateProgress(null);
      try {
        const result = await desktopApi().downloadLaunchBox();
        setImported(`${result.count.toLocaleString()} LaunchBox games downloaded and imported.`);
      } finally {
        setUpdating(false);
      }
    });
  }
  function cancelLaunchBox() {
    void desktopApi().cancelLaunchBoxDownload().catch(reason => setError(String(reason)));
  }
  function importLaunchBox() {
    return execute(async function importCatalogue() {
      setImported('');
      const result = await desktopApi().importLaunchBox();
      if (result) setImported(`${result.count.toLocaleString()} LaunchBox games imported.`);
    });
  }
  function artwork(refresh = false) {
    return execute(async function searchArtwork() {
      setNotice('');
      setCovers([]);
      const candidates = await desktopApi().searchLibretroCovers(
        systemOverride.trim() || entry.system, coverQuery.trim(), entry.relativePath, refresh
      );
      setCovers(candidates);
      if (!candidates.length) {
        setNotice('No downloadable box art matched this title. Try a shorter game title or refresh the catalogue.');
      }
    });
  }
  function selectCover(artworkId: string) {
    setForm(current => ({ ...current, artworkId }));
    setNotice('Cover selected. Click Save manual metadata to keep it.');
  }
  function save() {
    return execute(async function saveMetadata() {
      setForm(await desktopApi().metadataSave(target, manualMetadata(form, systemOverride)));
      setNotice('Manual metadata saved.');
      onSaved();
    });
  }

  return {
    entry, onClose, preferences, showArtworkSearch, toggleArtworkSearch, form, systemOverride,
    query, results, imported, coverQuery, covers, updating, progressText: launchBoxProgress(updateProgress), busy, error, notice,
    set, setSystemOverride, setQuery, setCoverQuery, search, apply, updateLaunchBox, cancelLaunchBox,
    importLaunchBox, artwork, selectCover, save
  };
}

export type MetadataController = ReturnType<typeof useMetadataController>;
