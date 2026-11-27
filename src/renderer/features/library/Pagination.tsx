import React from 'react';
import { pagination } from './library-model';

interface Props {
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  changeOffset(offset: number): void;
  gallery?: boolean;
}

export function Pagination({ total, offset, limit, loading, changeOffset, gallery = false }: Props) {
  const model = pagination(total, offset, limit, loading);
  return <div className="pagination" aria-label={gallery ? 'Gallery pagination' : 'Library pagination'}>
    <span>{model.range} of {total.toLocaleString()}{gallery ? '' : ' games'}{loading ? ' · Loading…' : ''}</span>
    <div>
      <button disabled={model.previousDisabled} onClick={() => changeOffset(model.previousOffset)}>Previous</button>
      <button disabled={model.nextDisabled} onClick={() => changeOffset(model.nextOffset)}>Next</button>
    </div>
  </div>;
}
