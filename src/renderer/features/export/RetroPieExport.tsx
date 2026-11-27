import React from 'react';
import { useExport, type ExportViewModel, type ExportPanelProps } from './useExport';

export function RetroPieExport(props: ExportPanelProps) {
  const model = useExport(props);
  return <RetroPieExportView model={model} />;
}

export function RetroPieExportView({ model }: { model: ExportViewModel }) {
  const {
    source, onClose, destination, includeArtwork, mappings, preview, completed,
    busy, error, done, changeArtwork, changeMapping, choose, requestPreview, run
  } = model;
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
        onChange={e => changeArtwork(e.target.checked)}
      /> Include cached artwork</label>
      <h3>System mapping</h3>
      <p>Unknown systems require a RetroPie folder name. Check mappings for your configured emulators.</p>
      <div className="retropie-mappings">
        {mappings.map(({ system, folder }) => <label key={system}>
          <span title={system}>{system}</span>
          <input
            aria-label={`RetroPie folder for ${system}`}
            value={folder}
            placeholder="e.g. nes"
            maxLength={50}
            disabled={busy}
            onChange={e => changeMapping(system, e.target.value)}
          />
        </label>)}
      </div>
      <button className="primary" disabled={busy || !destination} onClick={requestPreview}>Preview configuration</button>
      {preview && <div className="retropie-preview">
        <h3>Preview</h3>
        <p>{preview.summary.references} ROM references · {preview.plan.systems.length} systems · {preview.plan.skippedRoms} ROMs skipped</p>
        <p>{preview.summary.created} new files · {preview.summary.updated} gamelists to merge and back up · {preview.summary.reused} unchanged files · {preview.summary.mibToWrite} MiB to write (excluding backups)</p>
        <p>ROMs will not be copied. Generated gamelists reference files expected in each destination system folder.</p>
        <p>Output: <code>{preview.plan.destination}</code></p>
        {!!preview.plan.warnings.length && <>
          <strong>Skipped games / omitted artwork (export can continue)</strong>
          <ul>{preview.plan.warnings.slice(0, 40).map((w, i) => <li key={i}>{w}</li>)}</ul>
          {preview.plan.warnings.length > 40 && <p>First 40 of {preview.plan.warnings.length} warnings shown.</p>}
        </>}
        {!!preview.plan.conflicts.length && <>
          <strong>Conflicts (export blocked)</strong>
          <ul>{preview.plan.conflicts.slice(0, 40).map(c => <li key={c}>{c}</li>)}</ul>
          {preview.plan.conflicts.length > 40 && <p>First 40 of {preview.plan.conflicts.length} conflicts shown.</p>}
        </>}
        <details>
          <summary>View planned paths ({preview.plan.files.length}; ROMs are references only)</summary>
          <ul>
            {preview.plan.files.slice(0, 100).map(f => <li key={f.relativeDestination}>
              {f.relativeDestination}
              {f.kind === 'rom' ? ' (not copied)' : f.action ? ` (${f.action})` : ' (conflict)'}
            </li>)}
          </ul>
          {preview.plan.files.length > 100 && <p>First 100 paths shown.</p>}
        </details>
        <button
          className="primary"
          disabled={busy || !preview.summary.canGenerate}
          onClick={() => void run()}
        >Generate / update configuration</button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="identity-message" role="status">{done}</p>}
      {completed && <div className="retropie-preview">
        <p>Output: <code>{completed.plan.destination}</code></p>
        <details>
          <summary>Written files ({completed.summary.writtenFiles.length})</summary>
          <ul>
            {completed.summary.writtenFiles.map(f => <li key={f.relativeDestination}>{f.relativeDestination} ({f.action})</li>)}
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
