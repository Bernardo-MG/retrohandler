import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { AppSettings, CollectionInfo } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { useControllerState } from '../../hooks/useControllerState';
import { SettingsController } from './SettingsController';

export interface SettingsPanelProps {
  settings: AppSettings;
  collections: CollectionInfo[];
  onClose(): void;
  onSaved(settings: AppSettings): void;
}

export function useSettings({ settings, collections, onClose, onSaved }: SettingsPanelProps) {
  const [controller, state] = useControllerState(() => new SettingsController(desktopApi(), settings));
  const panel = useRef<HTMLElement>(null);

  useEffect(function loadStorageAndFocus() {
    panel.current?.focus();
    const request = new AbortController();
    void controller.refreshStorage(request.signal);
    return () => request.abort();
  }, [controller]);

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !controller.getSnapshot().busy) {
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
  return {
    ...state, collections, onClose, panel, keyDown,
    mappings: Object.entries(state.draft.export.overrides).sort(([a], [b]) => a.localeCompare(b)),
    updateLibrary: controller.updateLibrary, changeCollection: controller.changeCollection, clearFilters: controller.clearFilters,
    chooseDestination: controller.chooseDestination, removeMapping: controller.removeMapping,
    refreshStorage: () => controller.refreshStorage(), cleanup: controller.cleanup,
    save: () => controller.save(onSaved), reset: () => controller.reset(onSaved),
    changeTheme: controller.changeTheme, clearDestination: controller.clearDestination, changeArtwork: controller.changeArtwork,
    clearMappings: controller.clearMappings, changeMetadataStart: controller.changeMetadataStart,
    changeMetadataArtwork: controller.changeMetadataArtwork, requestReset: controller.requestReset, cancelReset: controller.cancelReset
  };
}

export type SettingsViewModel = ReturnType<typeof useSettings>;
