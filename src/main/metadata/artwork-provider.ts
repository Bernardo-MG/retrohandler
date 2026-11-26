import type { LibretroCoverChoice } from '../../shared';

export type CoverLookup = {
  system: string;
  names: readonly string[];
};

export type CoverSearch = {
  system: string;
  query: string;
  regionHint: string;
  refresh?: boolean;
};

export type CoverChoice = LibretroCoverChoice;

/** Artwork-only provider capability; descriptive metadata is independent. */
export interface ArtworkProvider {
  findCover(query: CoverLookup): Promise<string | null>;
  searchCovers(query: CoverSearch): Promise<CoverChoice[]>;
}
