import type { GameMetadataInput, LaunchBoxDownloadProgress, LibraryEntry } from '../../../shared';

export type MetadataField = keyof Pick<
  GameMetadataInput,
  'title' | 'description' | 'released' | 'developer' | 'publisher' | 'genre'
>;

export function initialMetadata(entry: LibraryEntry): GameMetadataInput {
  return (
    entry.metadata ?? {
      title: entry.identifiedTitle || entry.name,
      description: '',
      released: '',
      developer: '',
      publisher: '',
      genre: '',
      provider: 'manual',
      providerId: null,
      providerSlug: null,
      artworkId: null
    }
  );
}

export function cleanTitle(entry: LibraryEntry): string {
  return (entry.identifiedTitle || entry.name).replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
}

/** Manual edits retain artwork, but no longer imply a verified provider match. */
export function manualMetadata(form: GameMetadataInput, systemOverride: string): GameMetadataInput {
  return {
    ...form,
    systemOverride: systemOverride.trim() || null,
    provider: 'manual',
    providerId: null,
    providerSlug: null
  };
}

export function launchBoxProgress(progress: LaunchBoxDownloadProgress | null): string {
  if (!progress) {
    return '';
  }
  if (progress.phase === 'import') {
    return `Importing ${progress.processed.toLocaleString()} games…`;
  }
  const phase = progress.phase === 'download' ? 'Downloading' : 'Extracting';
  const size = (progress.processed / 1048576).toFixed(1);
  const total = progress.total ? ` / ${(progress.total / 1048576).toFixed(1)} MiB` : '';
  return `${phase} ${size} MiB${total}`;
}
