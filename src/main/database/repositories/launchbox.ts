import type { MetadataCandidate } from '../../../shared';
import type { LaunchBoxGame, LaunchBoxRepository } from '../../contracts/persistence';
import {
  LaunchBoxTitleMatcher,
  normalizeLaunchBoxName,
  type LaunchBoxCandidate
} from '../../metadata/launchbox/launchbox-title-matcher';
import { DatabaseConnection } from '../database-connection';
import { QueryExecutor } from '../sql/query-executor';

export class SqliteLaunchBoxRepository implements LaunchBoxRepository {
  constructor(private readonly executor: QueryExecutor) {}

  /** Stage imports separately so a failed parse cannot discard the previous catalogue. */
  public beginLaunchBoxImport(): void {
    this.executor.execute('launchbox.clearStaging');
  }

  public addLaunchBoxGame(game: LaunchBoxGame): void {
    this.executor.execute(
      'launchbox.insertStagingGame',
      game.id,
      game.title,
      game.platform,
      game.released,
      game.description,
      game.developer,
      game.publisher,
      game.genre,
      normalizeLaunchBoxName(game.title)
    );
  }

  public finishLaunchBoxImport(): number {
    return this.executor.transaction(() => {
      const count = this.executor.findRequired<{ n: number }>('launchbox.countStaging').n;
      if (!count) {
        throw new Error('LaunchBox XML contains no usable game records.');
      }
      this.executor.executeBatch('launchbox.publishStaging');
      return count;
    });
  }

  public abortLaunchBoxImport(): void {
    this.executor.execute('launchbox.clearStaging');
  }

  public searchLaunchBox(term: string, platform: string): MetadataCandidate[] {
    const matcher = new LaunchBoxTitleMatcher({ title: term, platform });
    const normalized = matcher.normalizedTitle;
    if (!normalized || normalized.length > 160) {
      throw new Error('Invalid LaunchBox search.');
    }
    // Prefix search uses the index; limit candidate work before ranking by platform.
    const escaped = normalized.replace(/[!%_]/g, (c) => `!${c}`);
    const candidates = this.executor.findAll<LaunchBoxCandidate>(
      'launchbox.search',
      normalized,
      `${escaped}%`
    );
    return matcher.rank(candidates);
  }

  public getLaunchBoxGame(id: number): LaunchBoxGame | null {
    return this.executor.findOne<LaunchBoxGame>('launchbox.getGame', id);
  }
}

export function createLaunchBoxRepository(database: DatabaseConnection): LaunchBoxRepository {
  return new SqliteLaunchBoxRepository(DatabaseConnection.executorFor(database));
}
