import { useEffect } from 'react';
import type { LibraryEntry, MetadataPreferences } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { useControllerState } from '../../hooks/useControllerState';
import { MetadataController } from './MetadataController';
import { launchBoxProgress } from './metadata-model';

export interface MetadataPanelProps {
  entry: LibraryEntry;
  onClose(): void;
  onSaved(): void;
  preferences: MetadataPreferences;
}

export function useMetadata({ entry, onClose, onSaved, preferences }: MetadataPanelProps) {
  const [controller, state] = useControllerState(() => new MetadataController(desktopApi(), entry, preferences));

  // The keyed editor preserves draft edits when the same game's library row refreshes.
  useEffect(function resetForNewGame() {
    controller.resetForNewGame(entry);
  }, [controller, entry.source, entry.relativePath]);
  useEffect(() => controller.connect(), [controller]);
  useEffect(function handleEscape() {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return {
    ...state, entry, onClose, preferences, progressText: launchBoxProgress(state.updateProgress),
    toggleArtworkSearch: controller.toggleArtworkSearch, set: controller.set,
    setSystemOverride: controller.setSystemOverride, setQuery: controller.setQuery, setCoverQuery: controller.setCoverQuery,
    search: () => controller.search(entry), apply: (id: number) => controller.apply(entry, id, onSaved),
    updateLaunchBox: controller.updateLaunchBox, cancelLaunchBox: controller.cancelLaunchBox,
    importLaunchBox: controller.importLaunchBox, artwork: (refresh = false) => controller.artwork(entry, refresh),
    selectCover: controller.selectCover, save: () => controller.save(entry, onSaved)
  };
}

export type MetadataViewModel = ReturnType<typeof useMetadata>;
