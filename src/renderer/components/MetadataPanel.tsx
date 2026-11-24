import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameMetadataInput, LibraryEntry, MetadataCandidate, MetadataTarget } from '../../shared';

const empty = (title: string): GameMetadataInput => ({ title, description: '', released: '', developer: '', publisher: '', genre: '', provider: 'manual', providerId: null, providerSlug: null, artworkId: null });
const cleanTitle = (entry: LibraryEntry) => (entry.identifiedTitle || entry.name).replace(/\s*[([][^)\]]*[)\]]/g, '').trim();

interface Props { entry: LibraryEntry; onClose(): void; onSaved(): void; }
export function MetadataPanel({ entry, onClose, onSaved }: Props) {
  const [form, setForm] = useState<GameMetadataInput>(entry.metadata ?? empty(entry.identifiedTitle || entry.name));
  const [systemOverride, setSystemOverride] = useState(entry.metadata?.systemOverride ?? '');
  const [query, setQuery] = useState(cleanTitle(entry));
  const [results, setResults] = useState<MetadataCandidate[]>([]);
  const [imported, setImported] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const target: MetadataTarget = { source: entry.source, relativePath: entry.relativePath };

  useEffect(() => {
    setForm(entry.metadata ?? empty(entry.identifiedTitle || entry.name));
    setSystemOverride(entry.metadata?.systemOverride ?? '');
    setQuery(cleanTitle(entry)); setResults([]); setError(''); setNotice('');
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
  async function importLaunchBox() {
    setBusy(true); setError(''); setImported('');
    try { const result = await window.retrohandler.importLaunchBox(); if (result) setImported(`${result.count.toLocaleString()} LaunchBox games imported.`); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function artwork() {
    setBusy(true); setError('');
    try {
      const id = await window.retrohandler.findLibretroArtwork(systemOverride.trim() || entry.system, [entry.relativePath, form.title]);
      if (!id) setNotice('No matching Libretro box art found. Try a No-Intro filename or another game title.');
      else { setForm(current => ({...current, artworkId:id})); setNotice('Cover found. Save manual metadata to keep it.'); }
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
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
        <label key={name}>{name[0].toUpperCase() + name.slice(1)}<input value={form[name]} maxLength={200} autoFocus={name === 'title'} onChange={event => set(name, event.target.value)}/></label>)}
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
      <p>LaunchBox uses a local database: download Metadata.zip from the LaunchBox Games Database, extract Metadata.xml, then import it. No API key required. Matches are never applied automatically.</p>
      <button className="secondary" disabled={busy} onClick={() => void importLaunchBox()}>Import LaunchBox Metadata.xml…</button>
      {imported && <p role="status">{imported}</p>}
      <label>Game title <input value={query} maxLength={120} onChange={event => setQuery(event.target.value)}/></label>
      <button className="secondary" disabled={busy || !query.trim()} onClick={() => void search()}>Search LaunchBox</button>
      {results.map(result => <div className="metadata-result" key={result.id}><span>{result.title} {result.released && `(${result.released})`} {result.platform && `— ${result.platform}`}</span><button disabled={busy} onClick={() => void apply(result.id)}>Use this match</button></div>)}
      {results.length > 0 && <p>Check the platform and edition before applying a match. Your manually assigned ROM system is retained.</p>}
      <h3>Libretro box art (no API key)</h3><p>Looks for an exact or simplified filename in Libretro's box-art catalogue. Search is platform-specific and does not overwrite your existing image unless you save.</p>
      <button className="secondary" disabled={busy} onClick={() => void artwork()}>Find Libretro box art</button>
    </div>
    {notice && <p role="status" className="identity-message">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    </section>
  </div>, document.body);
}
