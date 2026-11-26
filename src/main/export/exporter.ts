import type { ExportOptions, ExportPlan, LibraryEntry } from '../../shared';
import type { FileOperation } from './export-plan';

export type ExportDraft = {
  plan: Omit<ExportPlan, 'destination' | 'fingerprint'>;
  operations: FileOperation[];
};

/** Prepare a read-only preview and write operations for a validated destination. */
export interface Exporter {
  prepare(entries: readonly LibraryEntry[], options: ExportOptions, destination: string): Promise<ExportDraft>;
}
