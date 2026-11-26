import type { MetadataCandidate } from '../../../shared';
import type { LaunchBoxRepository } from '../../contracts/persistence';
import type { MetadataProvider, MetadataSearch, ProviderMetadata } from '../metadata-provider';

/** Access the imported offline catalogue without depending on SQLite. */
export class LaunchBoxProvider implements MetadataProvider {
  constructor(private readonly catalogue: Pick<LaunchBoxRepository, 'searchLaunchBox' | 'getLaunchBoxGame'>) {}

  search(request: MetadataSearch): MetadataCandidate[] {
    return this.catalogue.searchLaunchBox(request.query, request.system);
  }

  getCandidate(id: number): ProviderMetadata | null {
    const game = this.catalogue.getLaunchBoxGame(id);
    if (!game) {
      return null;
    }
    return {
      title: game.title,
      description: game.description,
      released: game.released,
      developer: game.developer,
      publisher: game.publisher,
      genre: game.genre,
      provider: 'launchbox',
      providerId: String(game.id),
      providerSlug: null
    };
  }
}
