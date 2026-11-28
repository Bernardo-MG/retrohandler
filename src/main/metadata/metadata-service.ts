import type { GameMetadata, GameMetadataInput, MetadataCandidate, MetadataTarget } from '../../shared';
import type { MetadataRepository } from '../contracts/persistence';
import type { MetadataProvider, MetadataSearch } from './metadata-provider';

/** Application metadata workflow, independent of Electron and concrete providers. */
export class MetadataService {
  constructor(
    private readonly repository: MetadataRepository,
    private readonly provider: MetadataProvider
  ) {}

  public search(request: MetadataSearch): MetadataCandidate[] {
    return this.provider.search(request);
  }

  public save(target: MetadataTarget, metadata: GameMetadataInput): GameMetadata {
    return this.repository.saveMetadata(target.source, target.relativePath, metadata);
  }

  public applyCandidate(target: MetadataTarget, id: number): GameMetadata {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error('Invalid LaunchBox match.');
    }
    const candidate = this.provider.getCandidate(id);
    if (!candidate) {
      throw new Error('LaunchBox game was not found in the imported catalogue.');
    }
    // Omit systemOverride so the repository preserves the user's system assignment.
    return this.save(target, {
      ...candidate,
      artworkId: this.repository.getArtworkId(target.source, target.relativePath)
    });
  }
}
