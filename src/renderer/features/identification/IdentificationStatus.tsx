import React from 'react';
import type { IdentificationProgress } from '../../../shared';

export function IdentificationStatus({
  progress,
  cancel
}: {
  progress: IdentificationProgress | null;
  cancel(): void;
}) {
  return (
    <section className="scan-status" role="status">
      <div>
        <strong>Identifying ROMs…</strong>
        <p>
          {progress
            ? `${progress.processed}/${progress.total} checked · ${progress.verified} verified · ${progress.unknown} unknown`
            : 'Starting identification…'}
        </p>
        <small>{progress?.currentPath}</small>
      </div>
      <button className="secondary" onClick={cancel}>
        Cancel identification
      </button>
    </section>
  );
}
