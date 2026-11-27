import { useEffect } from 'react';
import type { ExportPreferences } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { useControllerState } from '../../hooks/useControllerState';
import { ExportController } from './ExportController';
import { mappingRows, summarizePlan, validPreferences } from './export-model';

export interface ExportPanelProps {
  source: string | null;
  onClose(): void;
  preferences: ExportPreferences;
  onPreferencesChange(value: ExportPreferences): void;
}

export function useExport({ source, onClose, preferences, onPreferencesChange }: ExportPanelProps) {
  const [controller, state] = useControllerState(
    () => new ExportController(desktopApi(), source, preferences)
  );
  const { destination, includeArtwork, overrides, systems, plan, completed, busy, error, done } = state;

  useEffect(
    function loadSystems() {
      const request = new AbortController();
      void controller.loadSystems(source, request.signal);
      return () => request.abort();
    },
    [controller, source]
  );

  useEffect(
    function persistOptions() {
      const value = validPreferences({ destination, includeArtwork, overrides });
      if (value) onPreferencesChange(value);
    },
    [destination, includeArtwork, overrides, onPreferencesChange]
  );

  return {
    source,
    onClose,
    destination,
    includeArtwork,
    mappings: mappingRows(systems, overrides),
    preview: plan ? { plan, summary: summarizePlan(plan) } : null,
    completed: completed ? { ...completed, summary: summarizePlan(completed.plan) } : null,
    busy,
    error,
    done,
    changeArtwork: controller.changeArtwork,
    changeMapping: controller.changeMapping,
    choose: controller.choose,
    requestPreview: () => controller.requestPreview(source),
    run: () => controller.run(source)
  };
}

export type ExportViewModel = ReturnType<typeof useExport>;
