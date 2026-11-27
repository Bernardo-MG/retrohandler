import React from 'react';
import { createPortal } from 'react-dom';
import { SUGGESTED_SYSTEMS } from '../../utils/suggested-systems';
import { useMetadataController, type MetadataController, type MetadataPanelProps } from './useMetadataController';

export function MetadataPanel(props: MetadataPanelProps) {
  const model = useMetadataController(props);
  return <MetadataPanelView model={model} />;
}

export function MetadataPanelView({ model }: { model: MetadataController }) {
  const {
    entry, onClose, preferences, showArtworkSearch, toggleArtworkSearch, form, systemOverride,
    query, results, imported, coverQuery, covers, updating, progressText, busy, error, notice,
    set, setSystemOverride, setQuery, setCoverQuery, search, apply, updateLaunchBox, cancelLaunchBox,
    importLaunchBox, artwork, selectCover, save
  } = model;
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
        {SUGGESTED_SYSTEMS.map(name => <option key={name} value={name}/>)}
      </datalist>
      <p className="metadata-system-hint">Leave blank to use the scanner-detected system. A manual selection determines the RetroPie folder mapping.</p>
      <label className="metadata-description">Description<textarea value={form.description} maxLength={4000} rows={4} onChange={event => set('description', event.target.value)}/></label>
    </div>
    <button className="primary" disabled={busy || !form.title.trim()} onClick={() => void save()}>Save manual metadata</button>
    <div className="metadata-search">
      <h3>Find retro-game metadata</h3>
      <p>Download the official LaunchBox database and search locally without an API key. Manual XML import is also available.</p>
      <button className="secondary" disabled={busy} onClick={() => void updateLaunchBox()}>Download / Update LaunchBox Database</button>
      {updating && <button className="secondary" onClick={cancelLaunchBox}>Cancel download / import</button>}
      {updating && progressText && <p role="status">{progressText}</p>}
      <button className="secondary" disabled={busy} onClick={() => void importLaunchBox()}>Import LaunchBox Metadata.xml… (manual)</button>
      {imported && <p role="status">{imported}</p>}
      <label>Game title <input value={query} autoFocus={preferences.startWith === 'launchbox'} maxLength={120} onChange={event => setQuery(event.target.value)}/></label>
      <button className="secondary" disabled={busy || !query.trim()} onClick={() => void search()}>Search LaunchBox</button>
      {results.map(result => <div className="metadata-result" key={result.id}><span>{result.title} {result.released && `(${result.released})`} {result.platform && `— ${result.platform}`}</span><button disabled={busy} onClick={() => void apply(result.id)}>Use this match</button></div>)}
      {results.length > 0 && <p>Check the platform and edition before applying a match. Your manually assigned ROM system is retained.</p>}
      <div className="settings-artwork-heading"><h3>Libretro box art (no API key)</h3><button className="secondary" type="button" aria-expanded={showArtworkSearch} onClick={toggleArtworkSearch}>{showArtworkSearch ? 'Hide search' : 'Show search'}</button></div>
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
