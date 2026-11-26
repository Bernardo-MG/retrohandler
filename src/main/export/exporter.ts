import type { ExportOptions, LibraryEntry } from '../../shared';
import type { FileDestination } from '../components/file-operations/file-destination';
import type { ExportDraft } from './prepared-export';

/** Only the validated destination and target settings are needed by a strategy. */
export type ExportTargetOptions = Readonly<Pick<ExportOptions, 'includeArtwork' | 'overrides'> & { destination: FileDestination }>;

/** Prepare a read-only draft and write operations for a validated destination. */
export interface Exporter {
  prepareDraft(entries: readonly LibraryEntry[], options: ExportTargetOptions): Promise<ExportDraft>;
}
