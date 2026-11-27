import { useEffect, useRef, useState } from 'react';
import type { ExportOptions, ExportPlan, ExportPreferences } from '../../../shared';
import { desktopApi } from '../../api/desktop-api';
import { mappingRows, normalizedOverrides, summarizePlan, validPreferences } from './export-model';

export interface ExportPanelProps {
  source: string | null;
  onClose(): void;
  preferences: ExportPreferences;
  onPreferencesChange(value: ExportPreferences): void;
}

export function useExportController({ source, onClose, preferences, onPreferencesChange }: ExportPanelProps) {
  const [destination, setDestination] = useState(preferences.destination);
  const [includeArtwork, setIncludeArtwork] = useState(preferences.includeArtwork);
  const [systems, setSystems] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>(preferences.overrides);
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [completed, setCompleted] = useState<{ plan: ExportPlan; backups: string[] } | null>(null);
  const active = useRef(false);

  useEffect(function loadSystems() {
    let mounted = true;
    async function load() {
      try {
        const rows = await desktopApi().listSystems(source);
        if (mounted) setSystems(rows.map(row => row.system));
      } catch (reason) {
        if (mounted) setError(String(reason));
      }
    }
    void load();
    return () => { mounted = false; };
  }, [source]);

  useEffect(function persistOptions() {
    const value = validPreferences({ destination, includeArtwork, overrides });
    if (value) onPreferencesChange(value);
  }, [destination, includeArtwork, overrides, onPreferencesChange]);

  function options(): ExportOptions {
    return { source, destination, includeArtwork, overrides: normalizedOverrides(overrides) };
  }
  function changeArtwork(value: boolean) {
    setIncludeArtwork(value);
    setPlan(null);
  }
  function changeMapping(system: string, value: string) {
    setOverrides(current => ({ ...current, [system]: value.toLowerCase() }));
    setPlan(null);
  }

  async function execute(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      setPlan(null);
      setError(String(reason));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  function choose() {
    return execute(async function chooseDestination() {
      const folder = await desktopApi().chooseExportFolder();
      if (folder) {
        setDestination(folder);
        setPlan(null);
        setDone('');
        setCompleted(null);
      }
    });
  }
  function preview() {
    return execute(async function preparePreview() {
      setDone('');
      setCompleted(null);
      setPlan(await desktopApi().previewRetroPieExport(options()));
    });
  }
  function run() {
    if (!plan || !summarizePlan(plan).canGenerate) return;
    const approved = plan;
    return execute(async function generateConfiguration() {
      const receipt = await desktopApi().runRetroPieExport(options(), approved.fingerprint);
      const { reused } = summarizePlan(approved);
      setDone(`RetroPie configuration generated: ${receipt.copied} XML/artwork files written, ${reused} reused, ${approved.skippedRoms} ROMs skipped. No ROMs were copied.`);
      setCompleted({ plan: approved, backups: receipt.backups ?? [] });
      setPlan(null);
    });
  }

  return {
    source, onClose, destination, includeArtwork, mappings: mappingRows(systems, overrides),
    preview: plan ? { plan, summary: summarizePlan(plan) } : null,
    completed: completed ? { ...completed, summary: summarizePlan(completed.plan) } : null,
    busy, error, done, changeArtwork, changeMapping, choose, requestPreview: preview, run
  };
}

export type ExportController = ReturnType<typeof useExportController>;
