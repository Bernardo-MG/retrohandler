import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FolderOpen, Gamepad2, HardDrive, Library, Search, Settings2, Server, RefreshCw, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import type { ScanResult } from '../shared';
import './styles.css';

function App() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [system, setSystem] = useState('All systems');
  const systems = useMemo(() => {
    const counts = new Map<string, number>();
    data?.games.forEach(game => counts.set(game.system, (counts.get(game.system) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);
  const filtered = useMemo(() => data?.games.filter(g =>
    (system === 'All systems' || g.system === system) &&
    (g.name.toLowerCase().includes(query.toLowerCase()) || g.relativePath.toLowerCase().includes(query.toLowerCase()))
  ) ?? [], [data, system, query]);
  async function scan() {
    setError('');
    try {
      const folder = await window.retrohandler.chooseRomFolder();
      if (!folder) return;
      setBusy(true);
      const result = await window.retrohandler.scanFolder(folder);
      setData(result);
      setSystem('All systems'); setQuery('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Gamepad2 size={22}/></div><div><strong>Retro</strong><span>HANDLER</span></div></div>
      <div className="nav-title">WORKSPACE</div>
      <div className="nav-item active"><Library size={18}/> Game Library</div>
      <div className="nav-item muted"><HardDrive size={18}/> Metadata <span className="soon">Soon</span></div>
      <div className="nav-item muted"><Settings2 size={18}/> Configuration <span className="soon">Soon</span></div>
      <div className="nav-item muted"><Server size={18}/> Deployment <span className="soon">Soon</span></div>
      <div className="sidebar-bottom"><span className="status-dot"/> Local mode · v0.1.0</div>
    </aside>
    <main>
      <header><div><p className="eyebrow">COLLECTION OVERVIEW</p><h1>Game Library</h1><p className="subtitle">Discover and organize the games in your ROM collection.</p></div><button className="primary" onClick={scan} disabled={busy}>{busy ? <RefreshCw className="spin" size={17}/> : <FolderOpen size={17}/>} {busy ? 'Scanning…' : 'Scan ROM folder'}</button></header>
      {error && <div className="error"><AlertCircle size={18}/>{error}</div>}
      <section className="stats"><div className="stat"><div className="stat-icon"><Gamepad2/></div><div><span>Total games</span><strong>{data?.games.length.toLocaleString() ?? '—'}</strong></div></div><div className="stat"><div className="stat-icon"><HardDrive/></div><div><span>Systems detected</span><strong>{systems.length || '—'}</strong></div></div><div className="stat"><div className="stat-icon"><CheckCircle2/></div><div><span>Identified by folder / format</span><strong>{data ? `${Math.round(data.games.filter(x => x.system !== 'Needs identification').length / Math.max(data.games.length,1)*100)}%` : '—'}</strong></div></div></section>
      {data ? <><div className="source"><FolderOpen size={16}/><span title={data.source}>{data.source}</span><em>Scanned {new Date(data.scannedAt).toLocaleString()}</em></div><section className="library"><div className="library-header"><h2>All games <span>{filtered.length.toLocaleString()}</span></h2><div className="filters"><label className="search"><Search size={17}/><input placeholder="Search games or filenames" value={query} onChange={e=>setQuery(e.target.value)}/></label><select value={system} onChange={e=>setSystem(e.target.value)}><option>All systems</option>{systems.map(([name,count])=><option key={name} value={name}>{name} ({count})</option>)}</select></div></div><div className="table-wrap"><table><thead><tr><th>GAME</th><th>SYSTEM</th><th>TYPE</th><th>SIZE</th></tr></thead><tbody>{filtered.slice(0, 500).map(game=><tr key={game.id}><td><div className="game-name"><span className="game-icon"><Gamepad2 size={16}/></span><div><strong>{game.name || 'Untitled'}</strong><small title={game.relativePath}>{game.relativePath}</small></div></div></td><td>{game.system}</td><td><span className="pill">{game.extension}</span></td><td>{formatBytes(game.bytes)}</td></tr>)}</tbody></table>{filtered.length > 500 && <p className="limit">Showing the first 500 matching games. Refine your search to narrow the list.</p>}{filtered.length===0 && <div className="empty-small">No matching games.</div>}</div></section><p className="footnote">This preview never modifies, moves or deletes your ROMs. Folder and extension detection are preliminary; hash-based game identification comes next.</p></>
      : <section className="empty"><div className="empty-graphic"><Gamepad2 size={56}/></div><div className="ready">READY TO START</div><h2>Your retro collection, organized.</h2><p>Select a local or network-mounted ROM folder. RetroHandler will scan it, recognize common console folders and formats, and build a searchable inventory.</p><button onClick={scan} disabled={busy} className="secondary"><FolderOpen size={18}/> Choose collection folder <ChevronRight size={17}/></button><div className="safe"><CheckCircle2 size={15}/> Read-only scan. Your original files stay untouched.</div></section>}
    </main>
  </div>;
}
function formatBytes(n:number) { if(n<1024) return `${n} B`; if(n<1048576)return `${(n/1024).toFixed(1)} KB`; if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`;return `${(n/1073741824).toFixed(2)} GB`; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
