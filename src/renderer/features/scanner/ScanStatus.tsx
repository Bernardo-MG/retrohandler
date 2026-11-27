import React from 'react';
import type { ScanProgress } from '../../../shared';
interface Props {
  progress: ScanProgress | null;
  cancel: () => void;
}
export function ScanStatus({ progress, cancel }: Props) {
  return <section className="scan-status" role="status">
    <div>
      <strong>Scanning collection…</strong>
      <p>
        {progress ? `${progress.filesVisited.toLocaleString()} files checked · ${progress.gamesFound.toLocaleString()} entries · ${progress.warnings} warnings` : 'Starting scan…'}
      </p>
      <small title={progress?.currentPath}>{progress?.currentPath}</small>
    </div>
    <button className="secondary" onClick={cancel}>Cancel scan</button>
  </section>;
}
