import type { MetadataCandidate } from '../../../shared';
import type { LaunchBoxGame, LaunchBoxRepository } from '../../contracts/persistence';
import { DatabaseConnection } from '../database-connection';
import { QueryExecutor } from '../sql/query-executor';

type LaunchBoxCandidateRow = Pick<LaunchBoxGame, 'id' | 'title' | 'platform' | 'released'>;

export function normalizeLaunchBoxName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class SqliteLaunchBoxRepository implements LaunchBoxRepository {
  constructor(private readonly executor: QueryExecutor) {}

  /** Stage imports separately so a failed parse cannot discard the previous catalogue. */
  beginLaunchBoxImport(): void {
    this.executor.execute('launchbox.clearStaging');
  }

  addLaunchBoxGame(game: LaunchBoxGame): void {
    this.executor.execute('launchbox.insertStagingGame',
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

  finishLaunchBoxImport(): number {
    return this.executor.transaction(() => {
      const count = this.executor.findRequired<{ n: number }>('launchbox.countStaging').n;
      if (!count) {
        throw new Error('LaunchBox XML contains no usable game records.');
      }
      this.executor.executeBatch('launchbox.publishStaging');
      return count;
    });
  }

  abortLaunchBoxImport(): void {
    this.executor.execute('launchbox.clearStaging');
  }

  searchLaunchBox(term: string, platform: string): MetadataCandidate[] {
    const normalized = normalizeLaunchBoxName(term);
    if (!normalized || normalized.length > 160) {
      throw new Error('Invalid LaunchBox search.');
    }
    // Prefix search uses the index; limit candidate work before ranking by platform.
    const escaped = normalized.replace(/[!%_]/g, c => `!${c}`);
    const candidates = this.executor.findAll<LaunchBoxCandidateRow>('launchbox.search', normalized, `${escaped}%`);
    const alias: Record<string, string> = {
      'supernintendo': 'supernintendoentertainmentsystem',
      'megadrivegenesis': 'segagenesis',
      'playstation': 'sonyplaystation',
      'gameboy': 'nintendogameboy',
      'gameboycolor': 'nintendogameboycolor',
      'gameboyadvance': 'nintendogameboyadvance',
      'nintendo64': 'nintendo64',
      'nintendoentertainmentsystem': 'nintendoentertainmentsystem'
    };
    const rawPlatform = platform.toLowerCase().replace(/[^a-z0-9]/g, '');
    const platformKey = alias[rawPlatform] ?? rawPlatform;
    return candidates.sort((a, b) => {
      const score = (v: typeof a) => (normalizeLaunchBoxName(v.title) === normalized ? 4 : 0) +
        (platformKey && (v.platform.toLowerCase().replace(/[^a-z0-9]/g, '') === platformKey ||
          v.platform.toLowerCase().replace(/[^a-z0-9]/g, '') === rawPlatform) ? 2 : 0);
      return score(b) - score(a) || a.title.localeCompare(b.title) || a.id - b.id;
    }).slice(
      0,
      20
    ).map(v => ({
      id: v.id,
      title: v.title,
      released: v.released,
      slug: null,
      platform: v.platform
    }));
  }

  getLaunchBoxGame(id: number): LaunchBoxGame | null {
    return this.executor.findOne<LaunchBoxGame>('launchbox.getGame', id);
  }
}

export function createLaunchBoxRepository(database: DatabaseConnection): LaunchBoxRepository {
  return new SqliteLaunchBoxRepository(DatabaseConnection.executorFor(database));
}
