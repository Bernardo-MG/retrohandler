import React from 'react';
import { Gamepad2 } from 'lucide-react';
import type { LibraryEntry, LibraryPage } from '../../../shared';

import { formatBytes } from '../../utils/format-size';
import { Pagination } from './Pagination';

interface Props {
  page: LibraryPage;
  offset: number;
  limit: number;
  loading: boolean;
  changeOffset: (offset: number) => void;
  onSelect: (entry: LibraryEntry) => void;
}
export function LibraryTable({ page, offset, limit, loading, changeOffset, onSelect }: Props) {
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>GAME</th>
              <th>SYSTEM</th>
              <th>TYPE</th>
              <th>SIZE</th>
              <th>IDENTIFICATION</th>
              <th>METADATA</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((game) => (
              <tr key={`${game.source}\0${game.relativePath}`}>
                <td>
                  <div className="game-name">
                    <span className="game-icon">
                      <Gamepad2 size={16} />
                    </span>
                    <div>
                      <strong>{game.name || 'Untitled'}</strong>
                      <small title={`${game.source}/${game.relativePath}`}>{game.relativePath}</small>
                    </div>
                  </div>
                </td>
                <td>{game.system}</td>
                <td>
                  <span className="pill">{game.extension}</span>
                </td>
                <td>{formatBytes(game.bytes)}</td>
                <td>
                  <span
                    className={`pill identity-${game.identificationStatus ?? 'pending'}`}
                    title={game.datName ?? undefined}
                  >
                    {game.identificationStatus ?? 'pending'}
                  </span>
                  {game.identifiedTitle && <small className="identified-title">{game.identifiedTitle}</small>}
                </td>
                <td>
                  <button className="metadata-edit" onClick={() => onSelect(game)}>
                    {game.metadata?.artworkId ? (
                      <img src={`retro-art://cover/${game.metadata.artworkId}`} alt="" />
                    ) : null}
                    {game.metadata ? 'Edit details' : 'Add details'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {page.total === 0 && <p className="empty-small">No matching games.</p>}
      </div>
      <Pagination
        total={page.total}
        offset={offset}
        limit={limit}
        loading={loading}
        changeOffset={changeOffset}
      />
    </>
  );
}
