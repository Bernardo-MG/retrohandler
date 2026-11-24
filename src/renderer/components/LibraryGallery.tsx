import React from 'react';
import { Gamepad2 } from 'lucide-react';
import type { LibraryEntry, LibraryPage } from '../../shared';
interface Props { page: LibraryPage; offset: number; limit: number; loading: boolean; changeOffset(offset: number): void; onSelect(entry: LibraryEntry): void; }
export function LibraryGallery({ page, offset, limit, loading, changeOffset, onSelect }: Props) {
  return <>
    <div className="game-gallery">{page.items.map(game => <button className="game-card" key={`${game.source}\0${game.relativePath}`} onClick={() => onSelect(game)}>
      {game.metadata?.artworkId ? <img loading="lazy" src={`retro-art://cover/${game.metadata.artworkId}`} alt=""/> : <span className="game-card-placeholder"><Gamepad2 size={34}/></span>}
      <strong>{game.metadata?.title || game.identifiedTitle || game.name}</strong><small>{game.system}</small>
    </button>)}</div>
    {page.total === 0 && <p className="empty-small">No matching games.</p>}
    <div className="pagination" aria-label="Gallery pagination"><span>{page.total ? `${offset + 1}–${Math.min(offset + limit, page.total)}` : '0'} of {page.total.toLocaleString()}{loading ? ' · Loading…' : ''}</span>
      <div><button disabled={loading || offset === 0} onClick={() => changeOffset(Math.max(0, offset-limit))}>Previous</button><button disabled={loading || offset + limit >= page.total} onClick={() => changeOffset(offset+limit)}>Next</button></div>
    </div>
  </>;
}
