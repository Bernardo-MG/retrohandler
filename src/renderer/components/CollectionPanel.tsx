import React, { useState } from 'react';
import { Folder, Pencil, Trash2, X } from 'lucide-react';
import type { CollectionInfo } from '../../shared';

interface Props {
  collections: CollectionInfo[];
  selected: string | null;
  busy: boolean;
  select: (source: string | null) => void;
  rename: (source: string, label: string) => Promise<void>;
  remove: (source: string) => Promise<void>;
}

export function CollectionPanel({ collections, selected, busy, select, rename, remove }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  return <section className="collections-panel" aria-label="Collections">
    <div className="nav-title">COLLECTIONS</div>
    <button className={`collection-item ${selected === null ? 'selected' : ''}`} onClick={() => select(null)}>
      <Folder size={15}/> All collections <span>{collections.reduce((n, c) => n + c.gameCount, 0).toLocaleString()}</span>
    </button>
    {collections.map(collection => <div key={collection.rootPath} className="collection-entry">
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
          <button disabled={busy} aria-label={`Rename ${collection.label}`} title="Rename" onClick={() => { setLabel(collection.label); setEditing(collection.rootPath); }}><Pencil size={13}/></button>
          <button disabled={busy} aria-label={`Remove ${collection.label} from library`} title="Forget collection (ROM files untouched)" onClick={() => {
            if (window.confirm(`Forget “${collection.label}” from RetroHandler? Your ROM files will not be deleted.`)) void remove(collection.rootPath);
          }}><Trash2 size={13}/></button>
        </div>
      </>}
    </div>)}
  </section>;
}
