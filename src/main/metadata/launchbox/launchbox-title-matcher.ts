import type { MetadataCandidate } from '../../../shared';
import type { LaunchBoxGame } from '../../contracts/persistence';

export type LaunchBoxCandidate = Pick<LaunchBoxGame, 'id' | 'title' | 'platform' | 'released'>;

const PLATFORM_ALIASES: Readonly<Record<string, string>> = {
  supernintendo: 'supernintendoentertainmentsystem',
  megadrivegenesis: 'segagenesis',
  playstation: 'sonyplaystation',
  gameboy: 'nintendogameboy',
  gameboycolor: 'nintendogameboycolor',
  gameboyadvance: 'nintendogameboyadvance',
  nintendo64: 'nintendo64',
  nintendoentertainmentsystem: 'nintendoentertainmentsystem'
};

export function normalizeLaunchBoxName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePlatform(platform: string): string {
  return platform.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toMetadataCandidate(game: LaunchBoxCandidate): MetadataCandidate {
  return { id: game.id, title: game.title, released: game.released, slug: null, platform: game.platform };
}

/** Offline title and platform ranking, independent of SQL and persistence. */
export class LaunchBoxTitleMatcher {
  readonly normalizedTitle: string;
  private readonly platform: string;
  private readonly platformAlias: string;

  constructor(query: { title: string; platform: string }) {
    this.normalizedTitle = normalizeLaunchBoxName(query.title);
    this.platform = normalizePlatform(query.platform);
    this.platformAlias = Object.hasOwn(PLATFORM_ALIASES, this.platform) ? PLATFORM_ALIASES[this.platform] : this.platform;
  }

  rank(candidates: readonly LaunchBoxCandidate[]): MetadataCandidate[] {
    return [...candidates]
      .sort((first, second) => this.compare(first, second))
      .slice(0, 20)
      .map(toMetadataCandidate);
  }

  private compare(first: LaunchBoxCandidate, second: LaunchBoxCandidate): number {
    return this.score(second) - this.score(first) || first.title.localeCompare(second.title) || first.id - second.id;
  }

  private score(candidate: LaunchBoxCandidate): number {
    const titleScore = normalizeLaunchBoxName(candidate.title) === this.normalizedTitle ? 4 : 0;
    return titleScore + (this.matchesPlatform(candidate.platform) ? 2 : 0);
  }

  private matchesPlatform(platform: string): boolean {
    const normalized = normalizePlatform(platform);
    return !!this.platformAlias && (normalized === this.platformAlias || normalized === this.platform);
  }
}
