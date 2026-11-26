import type { ExportOptions, LibraryEntry } from '../../shared';
import type { ExportDraft } from './export-plan';

/** Only the validated destination and target settings are needed by a strategy. */
export type ExportTargetOptions = Readonly<Pick<ExportOptions, 'destination' | 'includeArtwork' | 'overrides'>>;

/** Prepare a read-only draft and write operations for a validated destination. */
export interface Exporter {
  prepare(entries: readonly LibraryEntry[], options: ExportTargetOptions): Promise<ExportDraft>;
}
