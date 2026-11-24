import React, { useState } from 'react';
import { Folder, Pencil, Settings2, Trash2, X } from 'lucide-react';
import type { CollectionInfo } from '../../shared';

const SUGGESTED_SYSTEMS = [
  'Nintendo Entertainment System', 'Super Nintendo', 'Game Boy', 'Game Boy Color',
  'Game Boy Advance', 'Nintendo 64', 'Nintendo DS', 'Mega Drive / Genesis',
  'Master System', 'Game Gear', 'PlayStation', 'PlayStation 2',
  'PlayStation Portable', 'Dreamcast', 'Sega Saturn', 'Arcade', 'Neo Geo',
  'PC Engine / TurboGrafx-16', 'Atari 2600', 'Atari 7800'
];

interface Props {
  collections: CollectionInfo[];
  selected: string | null;
  busy: boolean;
  select: (source: string | null) => void;
  rename: (source: string, label: string) => Promise<void>;
  remove: (source: string) => Promise<void>;
  assignSystem: (source: string, override: string | null) => Promise<number>;
}

export function CollectionPanel({ collections, selected, busy, select, rename, remove, assignSystem }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [system, setSystem] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function applySystem(collection: CollectionInfo, override: string | null) {
    if (saving || busy) return;
    const action = override ? `set the system to “${override}”` : 'clear manual system assignments';
    if (!window.confirm(`This will ${action} for all ${collection.gameCount.toLocaleString()} ROMs in “${collection.label}”. Continue?`)) return;
    setSaving(true); setError('');
    try {
      await assignSystem(collection.rootPath, override);
      setAssigning(null);
      setSystem('');
    } catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  }

  return <section className="collections-panel" aria-label="Collections">
    <div className="nav-title">COLLECTIONS</div>
    <button className={`collection-item ${selected === null ? 'selected' : ''}`} onClick={() => select(null)}>
      <Folder size={15}/> All collections <span>{collections.reduce((n, c) => n + c.gameCount, 0).toLocaleString()}</span>
    </button>
    {collections.map(collection => <React.Fragment key={collection.rootPath}>
      <div className="collection-entry">
        {editing === collection.rootPath ? <form className="rename-form" onSubmit={async e => {
          e.preventDefault(); setSaving(true);
          try { await rename(collection.rootPath, label); setEditing(null); }
          finally { setSaving(false); }
        }}>
          <input aria-label="Collection name" maxLength={120} required value={label} onChange={e => setLabel(e.target.value)}/>
          <button type="submit" disabled={saving}>Save</button>
          <button type="button" aria-label="Cancel rename" onClick={() => setEditing(null)}><X size={14}/></button>
        </form> : <>
          <button title={collection.rootPath} className={`collection-item ${selected === collection.rootPath ? 'selected' : ''}`} onClick={() => select(collection.rootPath)}>
            <Folder size={15}/><span className="collection-label">{collection.label}</span><span>{collection.gameCount.toLocaleString()}</span>
          </button>
          <div className="collection-actions">
            <button disabled={busy || saving} aria-label={`Set system for ${collection.label}`} title="Set system for entire collection" onClick={() => { setAssigning(collection.rootPath); setEditing(null); setSystem(''); setError(''); }}><Settings2 size={13}/></button>
            <button disabled={busy || saving} aria-label={`Rename ${collection.label}`} title="Rename" onClick={() => { setAssigning(null); setLabel(collection.label); setEditing(collection.rootPath); }}><Pencil size={13}/></button>
            <button disabled={busy || saving} aria-label={`Remove ${collection.label} from library`} title="Forget collection (ROM files untouched)" onClick={() => {
              if (window.confirm(`Forget “${collection.label}” from RetroHandler? Your ROM files will not be deleted.`)) void remove(collection.rootPath);
            }}><Trash2 size={13}/></button>
          </div>
        </>}
      </div>
      {assigning === collection.rootPath && <div className="collection-system-editor">
        <strong>System for “{collection.label}”</strong>
        <small>Apply to all {collection.gameCount.toLocaleString()} ROMs in this collection, regardless of active filters or pages.</small>
        <input aria-label={`System for ${collection.label}`} list="collection-system-options" maxLength={120} value={system} placeholder="Choose or type a system" disabled={saving} onChange={e => setSystem(e.target.value)}/>
        <datalist id="collection-system-options">{SUGGESTED_SYSTEMS.map(name => <option key={name} value={name}/>)}</datalist>
        <div className="collection-system-actions">
          <button disabled={saving || busy || !system.trim()} onClick={() => void applySystem(collection, system.trim())}>Apply to collection</button>
          <button disabled={saving || busy} onClick={() => void applySystem(collection, null)}>Clear overrides</button>
          <button disabled={saving} onClick={() => { setAssigning(null); setError(''); }}>Cancel</button>
        </div>
        {error && <small role="alert">{error}</small>}
      </div>}
    </React.Fragment>)}
  </section>;
}
