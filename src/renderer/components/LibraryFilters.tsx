import React from 'react';
import { Search } from 'lucide-react';
import type { LibrarySort, SystemCount } from '../../shared';
interface Props {
  search: string; setSearch: (v: string) => void;
  system: string | null; setSystem: (v: string | null) => void;
  systems: SystemCount[];
  sort: LibrarySort; setSort: (v: LibrarySort) => void;
  descending: boolean; setDescending: (v: boolean) => void;
}
export function LibraryFilters({search, setSearch, system, setSystem, systems, sort, setSort, descending, setDescending}: Props) {
  return <div className="filters">
    <label className="search"><Search size={17}/><input aria-label="Search games or filenames" placeholder="Search games or filenames" maxLength={256} value={search} onChange={e => setSearch(e.target.value)}/></label>
    <select aria-label="System" value={system ?? ''} onChange={e => setSystem(e.target.value || null)}>
      <option value="">All systems</option>{systems.map(s => <option key={s.system} value={s.system}>{s.system} ({s.count})</option>)}
    </select>
    <select aria-label="Sort games" value={sort} onChange={e => setSort(e.target.value as LibrarySort)}>
      <option value="name">Name</option><option value="system">System</option><option value="bytes">Size</option>
    </select>
    <label className="sort-desc"><input type="checkbox" checked={descending} onChange={e => setDescending(e.target.checked)}/> Descending</label>
  </div>;
}
