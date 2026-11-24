import React from 'react';
import { Gamepad2 } from 'lucide-react';
import type { LibraryEntry, LibraryPage } from '../../shared';
interface Props { page: LibraryPage; offset: number; limit: number; loading: boolean; changeOffset(offset: number): void; onSelect(entry: LibraryEntry): void; checked(entry: LibraryEntry): boolean; toggle(entry: LibraryEntry, enabled: boolean): void; }
export function LibraryGallery({ page, offset, limit, loading, changeOffset, onSelect, checked, toggle }: Props) {
  return <>
    <div className="game-gallery">{page.items.map(game => <div className="game-select-card" key={`${game.source}\0${game.relativePath}`}><label className="game-select-check"><input type="checkbox" aria-label={`Select ${game.name}`} checked={checked(game)} onChange={e => toggle(game, e.target.checked)}/> Select</label><button className="game-card" onClick={() => onSelect(game)}>
      {game.metadata?.artworkId ? <img loading="lazy" src={`retro-art://cover/${game.metadata.artworkId}`} alt=""/> : <span className="game-card-placeholder"><Gamepad2 size={34}/></span>}
      <strong>{game.metadata?.title || game.identifiedTitle || game.name}</strong><small>{game.system}</small>
    </button></div>)}</div>
    {page.total === 0 && <p className="empty-small">No matching games.</p>}
    <div className="pagination" aria-label="Gallery pagination"><span>{page.total ? `${offset + 1}–${Math.min(offset + limit, page.total)}` : '0'} of {page.total.toLocaleString()}{loading ? ' · Loading…' : ''}</span>
      <div><button disabled={loading || offset === 0} onClick={() => changeOffset(Math.max(0, offset-limit))}>Previous</button><button disabled={loading || offset + limit >= page.total} onClick={() => changeOffset(offset+limit)}>Next</button></div>
    </div>
  </>;
}
