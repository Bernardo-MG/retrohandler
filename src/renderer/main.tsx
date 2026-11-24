import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FolderOpen, Gamepad2, HardDrive, Library, Settings2, Server, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { CollectionInfo, IdentificationProgress, IdentificationStatus, LibraryEntry, LibraryPage, LibraryQuery, LibrarySort, ScanProgress, SystemCount } from '../shared';
import { CollectionPanel } from './components/CollectionPanel';
import { LibraryFilters } from './components/LibraryFilters';
import { LibraryTable } from './components/LibraryTable';
import { LibraryGallery } from './components/LibraryGallery';
import { MetadataPanel } from './components/MetadataPanel';
import { ScanStatus } from './components/ScanStatus';
import { RetroPieExport } from './components/RetroPieExport';
import './styles.css';

const PAGE_SIZE = 100;
const EMPTY_PAGE: LibraryPage = { items: [], total: 0 };

function App() {
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [details, setDetails] = useState<LibraryEntry | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<LibraryPage>(EMPTY_PAGE);
  const [systems, setSystems] = useState<SystemCount[]>([]);
  const [search, setSearch] = useState('');
  const [system, setSystem] = useState<string | null>(null);
  const [sort, setSort] = useState<LibrarySort>('name');
  const [identityFilter, setIdentityFilter] = useState<IdentificationStatus | null>(null);
  const [descending, setDescending] = useState(false);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [identProgress, setIdentProgress] = useState<IdentificationProgress | null>(null);
  const identityJob = useRef<string | null>(null);
  const [identityMessage, setIdentityMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const activeJob = useRef<string | null>(null);
  const requestId = useRef(0);

  const reloadCollections = useCallback(async () => {
    const results = await window.retrohandler.listCollections();
    setCollections(results);
    setRevision(v => v + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    void window.retrohandler.listCollections()
      .then(results => { if (mounted) setCollections(results); })
      .catch(reason => { if (mounted) setError(`Could not load collections: ${String(reason)}`); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => window.retrohandler.onIdentificationProgress(update => {
    if (update.jobId === identityJob.current) setIdentProgress(update.progress);
  }), []);

  useEffect(() => window.retrohandler.onScanProgress(update => {
    if (update.jobId === activeJob.current) setProgress(update.progress);
  }), []);

  useEffect(() => {
    let cancelled = false;
    void window.retrohandler.listSystems(selected).then(found => {
      if (!cancelled) setSystems(found);
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [selected, revision]);

  // Do not query SQLite on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const query: LibraryQuery = { identification: identityFilter, source: selected, search: debouncedSearch, system, sort, descending, offset, limit: PAGE_SIZE };
    void window.retrohandler.queryLibrary(query).then(result => {
      if (id === requestId.current) setPage(result);
    }).catch(reason => { if (id === requestId.current) setError(String(reason)); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [selected, debouncedSearch, system, sort, descending, offset, identityFilter, revision]);

  useEffect(() => { setDetails(null); }, [selected, offset, system, sort, descending, debouncedSearch, identityFilter]);

  async function assignCollectionSystem(source: string, systemOverride: string | null): Promise<number> {
    // The source is always a single collection; current page filters must not limit this operation.
    const updated = await window.retrohandler.bulkAssignSystem(
      { scope: 'filtered', filter: { source, search: '', system: null, identification: null } },
      systemOverride);
    await reloadCollections();
    return updated;
  }

  const selectCollection = (source: string | null) => {
    setSelected(source); setOffset(0); setSystem(null); setSearch(''); setIdentityFilter(null); setDetails(null);
  };
  const filterSystem = (value: string | null) => { setSystem(value); setOffset(0); };
  const filterSearch = (value: string) => { setSearch(value); setOffset(0); };
  const filterSort = (value: LibrarySort) => { setSort(value); setOffset(0); };
  const filterDescending = (value: boolean) => { setDescending(value); setOffset(0); };

  const rename = async (source: string, label: string) => {
    try { await window.retrohandler.renameCollection(source, label); await reloadCollections(); }
    catch (reason) { setError(String(reason)); }
  };
  const remove = async (source: string) => {
    try {
      await window.retrohandler.removeCollection(source);
      if (selected === source) selectCollection(null);
      await reloadCollections();
    } catch (reason) { setError(String(reason)); }
  };

  async function scan() {
    setError('');
    try {
      const folder = await window.retrohandler.chooseRomFolder();
      if (!folder) return;
      setBusy(true); setProgress(null);
      const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      activeJob.current = jobId;
      const receipt = await window.retrohandler.scanIndexedFolder(folder, jobId);
      await reloadCollections();
      selectCollection(receipt.source);
      if (receipt.warningCount) setError(`Scan completed with ${receipt.warningCount} warnings. Some files could not be read.`);
    } catch (reason) {
      if (!(reason instanceof Error && reason.message.includes('cancelled'))) setError(String(reason));
    } finally { activeJob.current = null; setBusy(false); setProgress(null); }
  }
  function cancel() {
    if (activeJob.current) void window.retrohandler.cancelScan(activeJob.current);
  }
  async function importDat() {
    setError('');
    try {
      const receipt = await window.retrohandler.importDat();
      if (receipt) setIdentityMessage(`Imported ${receipt.count.toLocaleString()} DAT entries from ${receipt.name}. Run Identify to update matches.`);
    } catch (reason) { setError(`DAT import failed: ${String(reason)}`); }
  }
  async function identify() {
    if (!selected) return;
    setError(''); setIdentifying(true); setIdentProgress(null); setIdentityMessage('');
    const jobId = `identify_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    identityJob.current = jobId;
    try {
      const result = await window.retrohandler.identifyCollection(selected, jobId);
      setIdentityMessage(`Identified ${result.verified} verified, ${result.probable} probable, ${result.ambiguous} ambiguous, ${result.unknown} unknown, ${result.unsupported} unsupported, ${result.errors} errors.`);
      setRevision(value => value + 1);
    } catch (reason) {
      if (!String(reason).toLowerCase().includes('cancelled')) setError(`Identification failed: ${String(reason)}`);
    } finally { identityJob.current = null; setIdentifying(false); setIdentProgress(null); }
  }
  function cancelIdentity() {
    if (identityJob.current) void window.retrohandler.cancelIdentification(identityJob.current);
  }

  const totalGames = collections.reduce((n, c) => n + c.gameCount, 0);
  const selectedInfo = collections.find(c => c.rootPath === selected);
  const platformTotal = useMemo(() => systems.length, [systems]);
  const identified = systems.filter(s => s.system !== 'Needs identification').reduce((n, s) => n + s.count, 0);
  const selectedCount = selectedInfo?.gameCount ?? totalGames;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Gamepad2 size={22}/></div><div><strong>Retro</strong><span>HANDLER</span></div></div>
      <div className="nav-title">WORKSPACE</div>
      <div className="nav-item active"><Library size={18}/> Game Library</div>
      <div className="nav-item"><HardDrive size={18}/> Metadata <span className="soon">In library</span></div>
      <div className="nav-item muted"><Settings2 size={18}/> Configuration <span className="soon">Soon</span></div>
      <div className="nav-item muted"><Server size={18}/> Deployment <span className="soon">Soon</span></div>
      <CollectionPanel collections={collections} selected={selected} busy={busy} select={selectCollection} rename={rename} remove={remove} assignSystem={assignCollectionSystem}/>
      <div className="sidebar-bottom"><span className="status-dot"/> Local mode · v0.4</div>
    </aside>
    <main>
      <header><div><p className="eyebrow">COLLECTION OVERVIEW</p><h1>Game Library</h1><p className="subtitle">Discover and organize the games in your ROM collection.</p></div>
        <div className="identity-actions">
          <button className="secondary" disabled={busy || identifying || !collections.length} onClick={() => setShowExport(true)}>RetroPie export</button>
          <button className="secondary" disabled={busy || identifying} onClick={() => void importDat()}>Import DAT XML</button>
          <button className="secondary" disabled={busy || identifying || !selected} onClick={() => void identify()}>Identify collection</button>
        </div>
        <button className="primary" onClick={scan} disabled={busy || identifying}>{busy ? <RefreshCw className="spin" size={17}/> : <FolderOpen size={17}/>} {busy ? 'Scanning…' : 'Scan ROM folder'}</button>
      </header>
      {busy && <ScanStatus progress={progress} cancel={cancel}/>}
      {identifying && <section className="scan-status" role="status"><div><strong>Identifying ROMs…</strong><p>{identProgress ? `${identProgress.processed}/${identProgress.total} checked · ${identProgress.verified} verified · ${identProgress.unknown} unknown` : 'Starting identification…'}</p><small>{identProgress?.currentPath}</small></div><button className="secondary" onClick={cancelIdentity}>Cancel identification</button></section>}
      {identityMessage && <div className="identity-message" role="status">{identityMessage}</div>}
      {error && <div className="error" role="alert"><AlertCircle size={18}/>{error}<button className="dismiss-error" onClick={() => setError('')}>Dismiss</button></div>}
      <section className="stats">
        <div className="stat"><div className="stat-icon"><Gamepad2/></div><div><span>Games in selection</span><strong>{selectedCount.toLocaleString()}</strong></div></div>
        <div className="stat"><div className="stat-icon"><HardDrive/></div><div><span>Systems detected</span><strong>{platformTotal}</strong></div></div>
        <div className="stat"><div className="stat-icon"><CheckCircle2/></div><div><span>Identified by folder / format</span><strong>{selectedCount ? `${Math.round(identified / selectedCount * 100)}%` : '—'}</strong></div></div>
      </section>
      {selectedInfo && <div className="source"><FolderOpen size={16}/><span title={selectedInfo.rootPath}>{selectedInfo.rootPath}</span><em>Scanned {new Date(selectedInfo.scannedAt).toLocaleString()}</em></div>}
      {collections.length ? <section className="library">
        <div className="library-header"><h2>{selectedInfo?.label ?? 'All collections'} <span>{page.total.toLocaleString()}</span></h2>
          <label className="identity-filter">Identification <select aria-label="Identification status" value={identityFilter ?? ''} onChange={e => { setIdentityFilter((e.target.value || null) as IdentificationStatus | null); setOffset(0); }}>
            <option value="">All statuses</option>{['pending','verified','probable','ambiguous','unknown','unsupported','error'].map(status => <option key={status} value={status}>{status}</option>)}
          </select></label>
          <LibraryFilters search={search} setSearch={filterSearch} system={system} setSystem={filterSystem} systems={systems} sort={sort} setSort={filterSort} descending={descending} setDescending={filterDescending}/>
        </div>
        <div className="view-switch" role="group" aria-label="Library view"><button aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button><button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button></div>
        {view === 'list'
          ? <LibraryTable page={page} offset={offset} limit={PAGE_SIZE} loading={loading} changeOffset={setOffset} onSelect={setDetails}/>
          : <LibraryGallery page={page} offset={offset} limit={PAGE_SIZE} loading={loading} changeOffset={setOffset} onSelect={setDetails}/>}
        {details && <MetadataPanel key={`${details.source}\0${details.relativePath}`} entry={page.items.find(item => item.source === details.source && item.relativePath === details.relativePath) ?? details} onClose={() => setDetails(null)} onSaved={() => setRevision(value => value + 1)}/>}
      </section> : <section className="empty">
        <div className="empty-graphic"><Gamepad2 size={56}/></div><div className="ready">READY TO START</div>
        <h2>Your retro collection, organized.</h2><p>Select a local or network-mounted ROM folder. RetroHandler will index your collection and remember it between launches.</p>
        <button onClick={scan} disabled={busy} className="secondary"><FolderOpen size={18}/> Choose collection folder</button>
        <div className="safe"><CheckCircle2 size={15}/> Read-only scan. Your original files stay untouched.</div>
      </section>}
      {showExport && <RetroPieExport source={selected} onClose={() => setShowExport(false)}/>}
      <p className="footnote">Removing a collection only forgets its database entries; your original ROM files are never deleted.</p>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
