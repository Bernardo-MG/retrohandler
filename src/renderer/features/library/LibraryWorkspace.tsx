import React from 'react';
import type { IdentificationStatus, MetadataPreferences } from '../../../shared';
import { MetadataPanel } from '../metadata/MetadataPanel';
import { LibraryFilters } from './LibraryFilters';
import { LibraryTable } from './LibraryTable';
import { LibraryGallery } from './LibraryGallery';
import { PAGE_SIZE } from './library-model';
import type { LibraryViewModel } from './useLibrary';

const IDENTIFICATION_STATUSES: readonly IdentificationStatus[] = [
  'pending',
  'verified',
  'probable',
  'ambiguous',
  'unknown',
  'unsupported',
  'error'
];

export function LibraryWorkspace({
  library,
  metadataPreferences
}: {
  library: LibraryViewModel;
  metadataPreferences: MetadataPreferences;
}) {
  const { preferences, selectedInfo, page, systems, offset, loading, details } = library;
  const { search, system, sort, descending, identification, view } = preferences;
  const Games = view === 'list' ? LibraryTable : LibraryGallery;
  return (
    <section className="library">
      <div className="library-header">
        <h2>
          {selectedInfo?.label ?? 'All collections'} <span>{page.total.toLocaleString()}</span>
        </h2>
        <label className="identity-filter">
          Identification{' '}
          <select
            aria-label="Identification status"
            value={identification ?? ''}
            onChange={(event) =>
              library.filterIdentification((event.target.value || null) as IdentificationStatus | null)
            }
          >
            <option value="">All statuses</option>
            {IDENTIFICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <LibraryFilters
          search={search}
          setSearch={library.filterSearch}
          system={system}
          setSystem={library.filterSystem}
          systems={systems}
          sort={sort}
          setSort={library.filterSort}
          descending={descending}
          setDescending={library.filterDescending}
        />
      </div>
      <div className="view-switch" role="group" aria-label="Library view">
        <button aria-pressed={view === 'list'} onClick={() => library.setView('list')}>
          List
        </button>
        <button aria-pressed={view === 'grid'} onClick={() => library.setView('grid')}>
          Grid
        </button>
      </div>
      <Games
        page={page}
        offset={offset}
        limit={PAGE_SIZE}
        loading={loading}
        changeOffset={library.setOffset}
        onSelect={library.setDetails}
      />
      {details && (
        <MetadataPanel
          preferences={metadataPreferences}
          key={`${details.source}\0${details.relativePath}`}
          entry={details}
          onClose={library.closeDetails}
          onSaved={library.refresh}
        />
      )}
    </section>
  );
}
