import React from 'react';
import { Folder, Pencil, Settings2, Trash2, X } from 'lucide-react';
import { SUGGESTED_SYSTEMS } from '../../utils/suggested-systems';
import { useCollection, type CollectionViewModel, type CollectionPanelProps } from './useCollection';

export function CollectionPanel(props: CollectionPanelProps) {
  const model = useCollection(props);
  return <CollectionPanelView model={model} />;
}

export function CollectionPanelView({ model }: { model: CollectionViewModel }) {
  const {
    collections, selected, busy, select, editing, assigning, label, system, saving, error, totalGames,
    setLabel, setSystem, beginAssignment, beginRename, cancelAssignment, cancelRename,
    submitName, forget, applySelectedSystem, clearSystem
  } = model;
  return <section className="collections-panel" aria-label="Collections">
    <div className="nav-title">COLLECTIONS</div>
    <button className={`collection-item ${selected === null ? 'selected' : ''}`} onClick={() => select(null)}>
      <Folder size={15}/> All collections <span>{totalGames.toLocaleString()}</span>
    </button>
    {collections.map(collection => <React.Fragment key={collection.rootPath}>
      <div className="collection-entry">
        {editing === collection.rootPath ? <form className="rename-form" onSubmit={event => submitName(event, collection)}>
          <input aria-label="Collection name" maxLength={120} required value={label} onChange={e => setLabel(e.target.value)}/>
          <button type="submit" disabled={saving}>Save</button>
          <button type="button" aria-label="Cancel rename" onClick={cancelRename}><X size={14}/></button>
        </form> : <>
          <button title={collection.rootPath} className={`collection-item ${selected === collection.rootPath ? 'selected' : ''}`} onClick={() => select(collection.rootPath)}>
            <Folder size={15}/><span className="collection-label">{collection.label}</span><span>{collection.gameCount.toLocaleString()}</span>
          </button>
          <div className="collection-actions">
            <button disabled={busy || saving} aria-label={`Set system for ${collection.label}`} title="Set system for entire collection" onClick={() => beginAssignment(collection)}><Settings2 size={13}/></button>
            <button disabled={busy || saving} aria-label={`Rename ${collection.label}`} title="Rename" onClick={() => beginRename(collection)}><Pencil size={13}/></button>
            <button disabled={busy || saving} aria-label={`Remove ${collection.label} from library`} title="Forget collection (ROM files untouched)" onClick={() => forget(collection)}><Trash2 size={13}/></button>
          </div>
        </>}
      </div>
      {assigning === collection.rootPath && <div className="collection-system-editor">
        <strong>System for “{collection.label}”</strong>
        <small>Apply to all {collection.gameCount.toLocaleString()} ROMs in this collection, regardless of active filters or pages.</small>
        <input aria-label={`System for ${collection.label}`} list="collection-system-options" maxLength={120} value={system} placeholder="Choose or type a system" disabled={saving} onChange={e => setSystem(e.target.value)}/>
        <datalist id="collection-system-options">{SUGGESTED_SYSTEMS.map(name => <option key={name} value={name}/>)}</datalist>
        <div className="collection-system-actions">
          <button disabled={saving || busy || !system.trim()} onClick={() => void applySelectedSystem(collection)}>Apply to collection</button>
          <button disabled={saving || busy} onClick={() => void clearSystem(collection)}>Clear overrides</button>
          <button disabled={saving} onClick={cancelAssignment}>Cancel</button>
        </div>
        {error && <small role="alert">{error}</small>}
      </div>}
    </React.Fragment>)}
  </section>;
}
