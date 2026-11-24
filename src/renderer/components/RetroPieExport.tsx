import React, { useEffect, useState } from 'react';
import { RETROPIE_SYSTEM_MAP, type ExportOptions, type ExportPlan } from '../../shared';

interface Props { source: string | null; onClose: () => void; }
export function RetroPieExport({ source, onClose }: Props) {
  const [destination, setDestination] = useState('');
  const [includeArtwork, setIncludeArtwork] = useState(true);
  const [systems, setSystems] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string,string>>({});
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    let active = true;
    void window.retrohandler.listSystems(source).then(rows => {
      if (active) setSystems(rows.map(row => row.system));
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [source]);
  const options: ExportOptions = { source, destination, includeArtwork, overrides };
  async function choose() {
    const folder = await window.retrohandler.chooseExportFolder();
    if (folder) { setDestination(folder); setPlan(null); }
  }
  async function preview() {
    setError(''); setDone(''); setBusy(true);
    try { setPlan(await window.retrohandler.previewRetroPieExport(options)); }
    catch (e) { setPlan(null); setError(String(e)); }
    finally { setBusy(false); }
  }
  async function run() {
    if (!plan) return;
    setBusy(true); setError('');
    try {
      const receipt = await window.retrohandler.runRetroPieExport(options, plan.fingerprint);
      setDone(`Export completed: ${receipt.copied} files created.`);
      setPlan(null);
    } catch (e) { setPlan(null); setError(String(e)); }
    finally { setBusy(false); }
  }
  return <div className="retropie-overlay"><section className="retropie-panel" role="dialog" aria-modal="true" aria-label="RetroPie export">
    <div className="metadata-heading"><div><h2>RetroPie export</h2><small>Read-only sources · no overwrites · preview required</small></div><button className="secondary" onClick={onClose} disabled={busy}>Close</button></div>
    <p>{source ? 'Export the selected collection.' : 'Export all indexed collections.'} Games are copied intact, including compressed ZIP/RAR/7z files.</p>
    <div className="retropie-destination"><label>Destination folder<input readOnly value={destination} placeholder="Choose an empty folder"/></label><button className="secondary" disabled={busy} onClick={() => void choose()}>Browse…</button></div>
    <label className="retropie-checkbox"><input type="checkbox" checked={includeArtwork} onChange={e => { setIncludeArtwork(e.target.checked); setPlan(null); }}/> Include cached artwork</label>
    <h3>System mapping</h3><p>Unknown systems require a RetroPie folder name. Check mappings for your configured emulators.</p>
    <div className="retropie-mappings">{systems.map(system => <label key={system}><span title={system}>{system}</span><input aria-label={`RetroPie folder for ${system}`} value={overrides[system] ?? RETROPIE_SYSTEM_MAP[system] ?? ''} placeholder="e.g. nes" onChange={e => { setOverrides(v => ({...v, [system]: e.target.value.toLowerCase()})); setPlan(null); }}/></label>)}</div>
    <button className="primary" disabled={busy || !destination} onClick={() => void preview()}>Preview export</button>
    {plan && <div className="retropie-preview"><h3>Preview</h3>
      <p>{plan.files.filter(f => f.kind === 'rom').length} ROMs · {plan.systems.length} systems · {(plan.bytes / (1024*1024)).toFixed(1)} MiB of ROMs and artwork</p>
      <p>Output: <code>{plan.destination}</code></p>
      {!!plan.warnings.length && <><strong>Warnings (export blocked)</strong><ul>{plan.warnings.slice(0, 40).map((w, i) => <li key={i}>{w}</li>)}</ul></>}
      {!!plan.conflicts.length && <><strong>Existing files (export blocked)</strong><ul>{plan.conflicts.slice(0, 40).map(c => <li key={c}>{c}</li>)}</ul></>}
      <details><summary>View proposed files ({plan.files.length})</summary><ul>{plan.files.slice(0, 100).map(f => <li key={f.relativeDestination}>{f.relativeDestination}</li>)}</ul>{plan.files.length > 100 && <p>First 100 files shown.</p>}</details>
      <button className="primary" disabled={busy || !plan.files.length || !!plan.conflicts.length || !!plan.warnings.length} onClick={() => void run()}>Confirm and export</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}{done && <p className="identity-message" role="status">{done}</p>}
  </section></div>;
}
