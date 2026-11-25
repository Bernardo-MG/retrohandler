import React, { useEffect, useState } from 'react';
import { RETROPIE_SYSTEM_MAP, type ExportOptions, type ExportPlan, type ExportPreferences } from '../../shared';

interface Props {
  source: string | null;
  onClose: () => void;
  preferences: ExportPreferences;
  onPreferencesChange: (value: ExportPreferences) => void;
}
export function RetroPieExport({ source, onClose, preferences, onPreferencesChange }: Props) {
  const [destination, setDestination] = useState(preferences.destination);
  const [includeArtwork, setIncludeArtwork] = useState(preferences.includeArtwork);
  const [systems, setSystems] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>(preferences.overrides);
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [completed, setCompleted] = useState<{
    plan: ExportPlan;
    backups: string[]
  } | null>(null);
  useEffect(
    () => {
      let active = true;
      void window.retrohandler.listSystems(source).then(rows => {
        if (active) {
          setSystems(rows.map(row => row.system));
        }
      }).catch(reason => {
        if (active) {
          setError(String(reason));
        }
      });
      return () => {
        active = false;
      };
    },
    [source]
  );
  // Empty overrides restore the normal mapping. Persist only valid edits; the
  // export IPC still validates the full request before generating a preview.
  const normalizedOverrides = () => Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== ''));
  const options: ExportOptions = {
    source,
    destination,
    includeArtwork,
    overrides: normalizedOverrides()
  };
  useEffect(
    () => {
      const mappings = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== ''));
      if (Object.entries(mappings).some(([key, value]) => !key.trim() || key.length > 256 ||
        ['__proto__', 'constructor', 'prototype'].includes(key) || !/^[a-z0-9][a-z0-9_-]{0,49}$/.test(value) ||
        ['con', 'prn', 'aux', 'nul'].includes(value))) {
        return;
      }
      onPreferencesChange({ destination, includeArtwork, overrides: mappings });
    },
    [destination, includeArtwork, overrides, onPreferencesChange]
  );
  async function choose() {
    const folder = await window.retrohandler.chooseExportFolder();
    if (folder) {
      setDestination(folder);
      setPlan(null);
      setDone('');
      setCompleted(null);
    }
  }
  async function preview() {
    setError('');
    setDone('');
    setCompleted(null);
    setBusy(true);
    try {
      setPlan(await window.retrohandler.previewRetroPieExport(options));
    }
    catch (e) {
      setPlan(null);
      setError(String(e));
    }
    finally {
      setBusy(false);
    }
  }
  async function run() {
    if (!plan) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const receipt = await window.retrohandler.runRetroPieExport(options, plan.fingerprint);
      setDone(`RetroPie configuration generated: ${receipt.copied} XML/artwork files written, ${plan.files.filter(f => f.action === 'reuse').length} reused, ${plan.skippedRoms} ROMs skipped. No ROMs were copied.`);
      setCompleted({ plan, backups: receipt.backups ?? [] });
      setPlan(null);
    } catch (e) {
      setPlan(null);
      setError(String(e));
    }
    finally {
      setBusy(false);
    }
  }
  return <div className="retropie-overlay">
    <section
      className="retropie-panel"
      role="dialog"
      aria-modal="true"
      aria-label="RetroPie export"
    >
      <div className="metadata-heading">
        <div>
          <h2>RetroPie configuration</h2>
          <small>ROMs are never copied · gamelist backups · preview required</small>
        </div>
        <button className="secondary" onClick={onClose} disabled={busy}>Close</button>
      </div>
      <p>{source ? 'Generate configuration for the selected collection.' : 'Generate configuration for all indexed collections.'} Create or merge EmulationStation gamelist.xml files and optional cached artwork only. Existing game metadata not supplied by RetroHandler is preserved. Choose the folder containing (or intended to contain) the roms folder, including on a mounted USB drive or SD card. Place ROMs separately at the referenced paths.</p>
      <div className="retropie-destination">
        <label>Destination folder<input readOnly value={destination} placeholder="Choose a new or existing RetroPie folder" /></label>
        <button className="secondary" disabled={busy} onClick={() => void choose()}>Browse…</button>
      </div>
      <label className="retropie-checkbox"><input
        type="checkbox"
        checked={includeArtwork}
        disabled={busy}
        onChange={e => {
          setIncludeArtwork(e.target.checked);
          setPlan(null);
        }}
      /> Include cached artwork</label>
      <h3>System mapping</h3>
      <p>Unknown systems require a RetroPie folder name. Check mappings for your configured emulators.</p>
      <div className="retropie-mappings">
        {systems.map(system => <label key={system}>
          <span title={system}>{system}</span>
          <input
            aria-label={`RetroPie folder for ${system}`}
            value={overrides[system] ?? RETROPIE_SYSTEM_MAP[system] ?? ''}
            placeholder="e.g. nes"
            maxLength={50}
            disabled={busy}
            onChange={e => {
              setOverrides(v => ({ ...v, [system]: e.target.value.toLowerCase() }));
              setPlan(null);
            }}
          />
        </label>)}
      </div>
      <button className="primary" disabled={busy || !destination} onClick={() => void preview()}>Preview configuration</button>
      {plan && <div className="retropie-preview">
        <h3>Preview</h3>
        <p>{plan.files.filter(f => f.kind === 'rom').length} ROM references · {plan.systems.length} systems · {plan.skippedRoms} ROMs skipped</p>
        <p>{plan.files.filter(f => f.action === 'create').length} new files · {plan.files.filter(f => f.action === 'update').length} gamelists to merge and back up · {plan.files.filter(f => f.action === 'reuse').length} unchanged files · {(plan.files.filter(f => f.action === 'create' || f.action === 'update').reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(2)} MiB to write (excluding backups)</p>
        <p>ROMs will not be copied. Generated gamelists reference files expected in each destination system folder.</p>
        <p>Output: <code>{plan.destination}</code></p>
        {!!plan.warnings.length && <>
          <strong>Skipped games / omitted artwork (export can continue)</strong>
          <ul>{plan.warnings.slice(0, 40).map((w, i) => <li key={i}>{w}</li>)}</ul>
          {plan.warnings.length > 40 && <p>First 40 of {plan.warnings.length} warnings shown.</p>}
        </>}
        {!!plan.conflicts.length && <>
          <strong>Conflicts (export blocked)</strong>
          <ul>{plan.conflicts.slice(0, 40).map(c => <li key={c}>{c}</li>)}</ul>
          {plan.conflicts.length > 40 && <p>First 40 of {plan.conflicts.length} conflicts shown.</p>}
        </>}
        <details>
          <summary>View planned paths ({plan.files.length}; ROMs are references only)</summary>
          <ul>
            {plan.files.slice(0, 100).map(f => <li key={f.relativeDestination}>
              {f.relativeDestination}
              {f.kind === 'rom' ? ' (not copied)' : f.action ? ` (${f.action})` : ' (conflict)'}
            </li>)}
          </ul>
          {plan.files.length > 100 && <p>First 100 paths shown.</p>}
        </details>
        <button
          className="primary"
          disabled={busy || !plan.files.some(f => f.kind === 'rom') || !!plan.conflicts.length}
          onClick={() => void run()}
        >Generate / update configuration</button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="identity-message" role="status">{done}</p>}
      {completed && <div className="retropie-preview">
        <p>Output: <code>{completed.plan.destination}</code></p>
        <details>
          <summary>Written files ({completed.plan.files.filter(f => f.action === 'create' || f.action === 'update').length})</summary>
          <ul>
            {completed.plan.files.filter(f => f.action === 'create' || f.action === 'update').map(f => <li key={f.relativeDestination}>{f.relativeDestination} ({f.action})</li>)}
          </ul>
        </details>
        {!!completed.backups.length && <details open>
          <summary>Gamelist backups ({completed.backups.length})</summary>
          <ul>{completed.backups.map(p => <li key={p}>{p}</li>)}</ul>
        </details>}
        {!!completed.plan.warnings.length && <details>
          <summary>Skipped games / omitted artwork ({completed.plan.warnings.length} warnings)</summary>
          <ul>{completed.plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>}
      </div>}
    </section>
  </div>;
}
