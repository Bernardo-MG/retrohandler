import type { CollectionInfo, IdentificationStatus } from '../../shared';
import type { LaunchBoxGame } from '../contracts/persistence';
import type { RomHashes } from '../identification/hashes';

export type { DatabaseFactory, DatabaseHandle, Statement } from './sql/types';

export type CollectionRow = {
  root_path: string;
  scanned_at: string;
  ignored: number;
  warnings_json: string
};
export type RomRow = {
  id: string;
  name: string;
  system: string;
  relative_path: string;
  extension: string;
  bytes: number
};

export type LibraryRow = {
  source: string;
  id: string;
  name: string;
  system: string;
  relativePath: string;
  extension: string;
  bytes: number;
  identificationStatus: IdentificationStatus | null;
  identifiedTitle: string | null;
  datName: string | null;
  metadataTitle: string | null;
  metadataDescription: string | null;
  metadataReleased: string | null;
  metadataDeveloper: string | null;
  metadataPublisher: string | null;
  metadataGenre: string | null;
  metadataProvider: 'manual' | 'launchbox' | null;
  metadataProviderId: string | null;
  metadataProviderSlug: string | null;
  metadataArtworkId: string | null;
  metadataSystemOverride: string | null;
};

export type CollectionListRow = Omit<CollectionInfo, 'warningCount'> & {
  warningsJson: string
};
export type FingerprintRow = Omit<RomHashes, 'size'> & {
  bytes: number
};
export type FingerprintMatchRow = {
  game: string;
  datName: string;
  evidence: string
};
export type BulkTargetRow = {
  source: string;
  relativePath: string;
  name: string
};
export type LaunchBoxCandidateRow = Pick<LaunchBoxGame, 'id' | 'title' | 'platform' | 'released'>;
export type ArtworkRow = {
  artworkId: string | null
};
