import React from 'react';
import { Gamepad2 } from 'lucide-react';
import type { LibraryEntry, LibraryPage } from '../../../shared';
import { Pagination } from './Pagination';
interface Props {
  page: LibraryPage;
  offset: number;
  limit: number;
  loading: boolean;
  changeOffset(offset: number): void;
  onSelect(entry: LibraryEntry): void;
}
export function LibraryGallery({ page, offset, limit, loading, changeOffset, onSelect }: Props) {
  return (
    <>
      <div className="game-gallery">
        {page.items.map((game) => (
          <div className="game-select-card" key={`${game.source}\0${game.relativePath}`}>
            <button className="game-card" onClick={() => onSelect(game)}>
              {game.metadata?.artworkId ? (
                <img loading="lazy" src={`retro-art://cover/${game.metadata.artworkId}`} alt="" />
              ) : (
                <span className="game-card-placeholder">
                  <Gamepad2 size={34} />
                </span>
              )}
              <strong>{game.metadata?.title || game.identifiedTitle || game.name}</strong>
              <small>{game.system}</small>
            </button>
          </div>
        ))}
      </div>
      {page.total === 0 && <p className="empty-small">No matching games.</p>}
      <Pagination
        gallery
        total={page.total}
        offset={offset}
        limit={limit}
        loading={loading}
        changeOffset={changeOffset}
      />
    </>
  );
}
