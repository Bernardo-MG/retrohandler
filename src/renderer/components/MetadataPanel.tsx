import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameMetadataInput, LibraryEntry, MetadataCandidate, MetadataTarget, LibretroCoverChoice, MetadataPreferences } from '../../shared';

const empty = (title: string): GameMetadataInput => ({ title, description: '', released: '', developer: '', publisher: '', genre: '', provider: 'manual', providerId: null, providerSlug: null, artworkId: null });
const cleanTitle = (entry: LibraryEntry) => (entry.identifiedTitle || entry.name).replace(/\s*[([][^)\]]*[)\]]/g, '').trim();

interface Props { entry: LibraryEntry; onClose(): void; onSaved(): void; preferences: MetadataPreferences; }
export function MetadataPanel({ entry, onClose, onSaved, preferences }: Props) {
  const [showArtworkSearch, setShowArtworkSearch] = useState(preferences.artwork === 'libretro');
  const [form, setForm] = useState<GameMetadataInput>(entry.metadata ?? empty(entry.identifiedTitle || entry.name));
  const [systemOverride, setSystemOverride] = useState(entry.metadata?.systemOverride ?? '');
  const [query, setQuery] = useState(cleanTitle(entry));
  const [results, setResults] = useState<MetadataCandidate[]>([]);
  const [imported, setImported] = useState('');
  const [coverQuery, setCoverQuery] = useState(cleanTitle(entry));
  const [covers, setCovers] = useState<LibretroCoverChoice[]>([]);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<import('../../shared').LaunchBoxDownloadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const target: MetadataTarget = { source: entry.source, relativePath: entry.relativePath };

  useEffect(() => {
    setForm(entry.metadata ?? empty(entry.identifiedTitle || entry.name));
    setSystemOverride(entry.metadata?.systemOverride ?? '');
    setQuery(cleanTitle(entry)); setCoverQuery(cleanTitle(entry)); setCovers([]); setResults([]); setError(''); setNotice('');
  }, [entry.source, entry.relativePath]);
  function set(name: keyof Pick<GameMetadataInput,'title'|'description'|'released'|'developer'|'publisher'|'genre'>, value: string) {
    setForm(old => ({ ...old, [name]: value }));
  }
  async function search() {
    setBusy(true); setError(''); setNotice(''); setResults([]);
    try { setResults(await window.retrohandler.launchBoxSearch(query, systemOverride || entry.system)); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function apply(id: number) {
    setBusy(true); setError('');
    try {
      const metadata = await window.retrohandler.launchBoxApply(target, id);
      setForm(metadata); setSystemOverride(metadata.systemOverride ?? systemOverride); setResults([]); setNotice('Metadata matched and saved.'); onSaved();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => window.retrohandler.onLaunchBoxProgress(setUpdateProgress), []);
  async function updateLaunchBox() {
    setBusy(true); setUpdating(true); setError(''); setImported(''); setUpdateProgress(null);
    try {
      const result = await window.retrohandler.downloadLaunchBox();
      setImported(`${result.count.toLocaleString()} LaunchBox games downloaded and imported.`);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); setUpdating(false); }
  }
  async function importLaunchBox() {
    setBusy(true); setError(''); setImported('');
    try { const result = await window.retrohandler.importLaunchBox(); if (result) setImported(`${result.count.toLocaleString()} LaunchBox games imported.`); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function artwork(refresh = false) {
    setBusy(true); setError(''); setNotice(''); setCovers([]);
    try {
      const candidates = await window.retrohandler.searchLibretroCovers(
        systemOverride.trim() || entry.system, coverQuery.trim(), entry.relativePath, refresh);
      setCovers(candidates);
      if (!candidates.length) setNotice('No downloadable box art matched this title. Try a shorter game title or refresh the catalogue.');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function selectCover(artworkId: string) {
    setForm(current => ({...current, artworkId}));
    setNotice('Cover selected. Click Save manual metadata to keep it.');
  }
  async function save() {
    setBusy(true); setError('');
    try {
      // Editing manually preserves artwork, but no longer implies a verified provider match.
      const saved = await window.retrohandler.metadataSave(target, { ...form, systemOverride: systemOverride.trim() || null, provider: 'manual', providerId: null, providerSlug: null });
      setForm(saved); setNotice('Manual metadata saved.'); onSaved();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return createPortal(<div className="metadata-overlay">
    <section className="metadata-panel" role="dialog" aria-modal="true" aria-label="Game metadata" tabIndex={-1}>
    <div className="metadata-heading"><div><h2>Game details</h2><small>{entry.system} · {entry.relativePath}</small></div><button className="secondary" onClick={onClose}>Close</button></div>
    {form.artworkId && <img className="metadata-cover" src={`retro-art://cover/${form.artworkId}`} alt={`${form.title} artwork`}/>}
    <div className="metadata-fields">
      {(['title','released','developer','publisher','genre'] as const).map(name =>
        <label key={name}>{name[0].toUpperCase() + name.slice(1)}<input value={form[name]} maxLength={200} autoFocus={name === 'title' && preferences.startWith === 'manual'} onChange={event => set(name, event.target.value)}/></label>)}
      <label>System <input list="retrohandler-systems" value={systemOverride} maxLength={120}
        placeholder={`Auto: ${entry.system}`} onChange={event => setSystemOverride(event.target.value)}/></label>
      <datalist id="retrohandler-systems">
        {['Nintendo Entertainment System','Super Nintendo','Game Boy','Game Boy Color','Game Boy Advance','Nintendo 64','Nintendo DS','Mega Drive / Genesis','Master System','Game Gear','PlayStation','PlayStation 2','PlayStation Portable','Dreamcast','Sega Saturn','Arcade','Neo Geo','PC Engine / TurboGrafx-16','Atari 2600','Atari 7800'].map(name => <option key={name} value={name}/>)}
      </datalist>
      <p className="metadata-system-hint">Leave blank to use the scanner-detected system. A manual selection determines the RetroPie folder mapping.</p>
      <label className="metadata-description">Description<textarea value={form.description} maxLength={4000} rows={4} onChange={event => set('description', event.target.value)}/></label>
    </div>
    <button className="primary" disabled={busy || !form.title.trim()} onClick={() => void save()}>Save manual metadata</button>
    <div className="metadata-search">
      <h3>Find retro-game metadata</h3>
      <p>Download the official LaunchBox database and search locally without an API key. Manual XML import is also available.</p>
      <button className="secondary" disabled={busy} onClick={() => void updateLaunchBox()}>Download / Update LaunchBox Database</button>
      {updating && <button className="secondary" onClick={() => void window.retrohandler.cancelLaunchBoxDownload()}>Cancel download / import</button>}
      {updating && updateProgress && <p role="status">{updateProgress.phase === 'import' ? `Importing ${updateProgress.processed.toLocaleString()} games…` : `${updateProgress.phase === 'download' ? 'Downloading' : 'Extracting'} ${(updateProgress.processed / 1048576).toFixed(1)} MiB${updateProgress.total ? ` / ${(updateProgress.total / 1048576).toFixed(1)} MiB` : ''}`}</p>}
      <button className="secondary" disabled={busy} onClick={() => void importLaunchBox()}>Import LaunchBox Metadata.xml… (manual)</button>
      {imported && <p role="status">{imported}</p>}
      <label>Game title <input value={query} autoFocus={preferences.startWith === 'launchbox'} maxLength={120} onChange={event => setQuery(event.target.value)}/></label>
      <button className="secondary" disabled={busy || !query.trim()} onClick={() => void search()}>Search LaunchBox</button>
      {results.map(result => <div className="metadata-result" key={result.id}><span>{result.title} {result.released && `(${result.released})`} {result.platform && `— ${result.platform}`}</span><button disabled={busy} onClick={() => void apply(result.id)}>Use this match</button></div>)}
      {results.length > 0 && <p>Check the platform and edition before applying a match. Your manually assigned ROM system is retained.</p>}
      <div className="settings-artwork-heading"><h3>Libretro box art (no API key)</h3><button className="secondary" type="button" aria-expanded={showArtworkSearch} onClick={() => setShowArtworkSearch(value => !value)}>{showArtworkSearch ? 'Hide search' : 'Show search'}</button></div>
      {showArtworkSearch && <>
      <p>Search the assigned console's artwork catalogue by game title. Preview real downloadable images, then choose the correct region or edition.</p>
      <label>Artwork title <input value={coverQuery} maxLength={120} onChange={event => setCoverQuery(event.target.value)}/></label>
      <button className="secondary" disabled={busy || !coverQuery.trim()} onClick={() => void artwork()}>Find Libretro box art</button>
      <button className="secondary" disabled={busy || !coverQuery.trim()} onClick={() => void artwork(true)}>Refresh artwork catalogue</button>
      {covers.length > 0 && <div className="libretro-cover-grid" aria-label="Libretro box art search results">
        {covers.map(cover => <div className="libretro-cover-choice" key={cover.artworkId}>
          <img src={`retro-art://cover/${cover.artworkId}`} alt={cover.title}/>
          <small title={cover.title}>{cover.title}</small>
          <button className="secondary" disabled={busy} onClick={() => selectCover(cover.artworkId)}>{form.artworkId === cover.artworkId ? 'Selected' : 'Use this cover'}</button>
        </div>)}
      </div>}
      </>}
    </div>
    {notice && <p role="status" className="identity-message">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    </section>
  </div>, document.body);
}
