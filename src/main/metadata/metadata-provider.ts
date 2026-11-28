import type { GameMetadataInput, MetadataCandidate } from '../../shared';

export type MetadataSearch = { query: string; system: string };
export type ProviderMetadata = Omit<GameMetadataInput, 'artworkId' | 'systemOverride'>;

export interface MetadataProvider {
  search(request: MetadataSearch): MetadataCandidate[];
  getCandidate(id: number): ProviderMetadata | null;
}
