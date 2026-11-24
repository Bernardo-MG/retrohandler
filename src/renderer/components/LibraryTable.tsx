import React from 'react';
import { Gamepad2 } from 'lucide-react';
import type { LibraryPage } from '../../shared';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

interface Props { page: LibraryPage; offset: number; limit: number; loading: boolean; changeOffset: (offset: number) => void; }
export function LibraryTable({ page, offset, limit, loading, changeOffset }: Props) {
  const end = Math.min(offset + limit, page.total);
  return <>
    <div className="table-wrap"><table><thead><tr><th>GAME</th><th>SYSTEM</th><th>TYPE</th><th>SIZE</th></tr></thead>
      <tbody>{page.items.map(game => <tr key={`${game.source}\0${game.relativePath}`}>
        <td><div className="game-name"><span className="game-icon"><Gamepad2 size={16}/></span><div>
          <strong>{game.name || 'Untitled'}</strong>
          <small title={`${game.source}/${game.relativePath}`}>{game.relativePath}</small>
        </div></div></td><td>{game.system}</td><td><span className="pill">{game.extension}</span></td><td>{formatBytes(game.bytes)}</td>
      </tr>)}</tbody></table>
      {page.total === 0 && <p className="empty-small">No matching games.</p>}
    </div>
    <div className="pagination" aria-label="Library pagination">
      <span>{page.total ? `${offset + 1}–${end}` : '0'} of {page.total.toLocaleString()} games{loading ? ' · Loading…' : ''}</span>
      <div><button disabled={loading || offset === 0} onClick={() => changeOffset(Math.max(0, offset - limit))}>Previous</button>
        <button disabled={loading || end >= page.total} onClick={() => changeOffset(offset + limit)}>Next</button></div>
    </div>
  </>;
}
