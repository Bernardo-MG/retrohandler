import { useState, type FormEvent } from 'react';
import type { CollectionInfo } from '../../../shared';

export interface CollectionPanelProps {
  collections: CollectionInfo[];
  selected: string | null;
  busy: boolean;
  select(source: string | null): void;
  rename(source: string, label: string): Promise<void>;
  remove(source: string): Promise<void>;
  assignSystem(source: string, override: string | null): Promise<number>;
}

export function useCollectionController(props: CollectionPanelProps) {
  const { collections, selected, busy, select, rename, remove, assignSystem } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [system, setSystem] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function beginAssignment(collection: CollectionInfo) {
    setAssigning(collection.rootPath);
    setEditing(null);
    setSystem('');
    setError('');
  }
  function beginRename(collection: CollectionInfo) {
    setAssigning(null);
    setLabel(collection.label);
    setEditing(collection.rootPath);
  }
  function cancelAssignment() {
    setAssigning(null);
    setError('');
  }
  function cancelRename() { setEditing(null); }

  async function saveName(collection: CollectionInfo) {
    if (saving || busy) return;
    setSaving(true);
    try {
      await rename(collection.rootPath, label);
      setEditing(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }
  function submitName(event: FormEvent<HTMLFormElement>, collection: CollectionInfo) {
    event.preventDefault();
    void saveName(collection);
  }
  function forget(collection: CollectionInfo) {
    if (window.confirm(`Forget “${collection.label}” from RetroHandler? Your ROM files will not be deleted.`)) {
      void remove(collection.rootPath);
    }
  }
  async function applySystem(collection: CollectionInfo, override: string | null) {
    if (saving || busy) return;
    const action = override ? `set the system to “${override}”` : 'clear manual system assignments';
    if (!window.confirm(`This will ${action} for all ${collection.gameCount.toLocaleString()} ROMs in “${collection.label}”. Continue?`)) return;
    setSaving(true);
    setError('');
    try {
      await assignSystem(collection.rootPath, override);
      setAssigning(null);
      setSystem('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }
  function applySelectedSystem(collection: CollectionInfo) {
    return applySystem(collection, system.trim());
  }
  function clearSystem(collection: CollectionInfo) {
    return applySystem(collection, null);
  }

  return {
    collections, selected, busy, select, editing, assigning, label, system, saving, error,
    totalGames: collections.reduce((sum, collection) => sum + collection.gameCount, 0),
    setLabel, setSystem, beginAssignment, beginRename, cancelAssignment, cancelRename,
    submitName, forget, applySelectedSystem, clearSystem
  };
}

export type CollectionController = ReturnType<typeof useCollectionController>;
