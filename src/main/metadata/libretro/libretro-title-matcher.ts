import path from 'node:path';

const ROM_EXTENSION = /\.(nes|sfc|smc|gb|gbc|gba|n64|z64|v64|zip|7z|rar|cue|iso|chd)$/i;
const TRAILING_TAGS = /(?:\s*[([][^)\]]+[)\]])+$/g;
const REGION_TAGS =
  /(?:\s*[([](?:USA|Europe|Japan|World|Rev[^)\]]*|En[^)\]]*|Proto|Beta|USA, Europe|Europe, USA)[)\]])+$/gi;
const REGION_VARIANTS = ['USA', 'Europe', 'Japan', 'USA, Europe', 'World'];
const MAX_CANDIDATES = 24;
const MAX_MATCHES = 32;

type TitleMatch = { filename: string; score: number };
export type TitleQuery = { title: string; regionHint?: string };

/** Deterministic title matching; no network, artwork or catalogue state. */
export class LibretroTitleMatcher {
  public candidates(names: readonly string[]): string[] {
    const exact: string[] = [];
    const baseNames: string[] = [];
    for (const input of names) {
      const name = this.romTitle(input);
      this.addCandidate(exact, name);
      this.addBaseName(baseNames, name);
    }
    const candidates = [...exact];
    // Exact names always precede the common regional variants and bare title.
    for (const base of baseNames) {
      for (const region of REGION_VARIANTS) {
        this.addCandidate(candidates, `${base} (${region})`);
      }
    }
    for (const base of baseNames) {
      this.addCandidate(candidates, base);
    }
    return candidates.slice(0, MAX_CANDIDATES);
  }

  public match(files: readonly string[], query: TitleQuery): string[] {
    const needle = this.normalizedTitle(query.title);
    if (needle.length < 2) {
      return [];
    }
    const wantedRegion = this.detectRegion(query.regionHint || query.title);
    const matches: TitleMatch[] = [];
    for (const filename of files) {
      const score = this.scoreTitle(filename, needle, wantedRegion);
      if (score !== null) {
        matches.push({ filename, score });
      }
    }
    return matches
      .sort(compareMatches)
      .slice(0, MAX_MATCHES)
      .map((match) => match.filename);
  }

  private romTitle(input: string): string {
    return path.win32.basename(input.replace(/\//g, '\\')).replace(ROM_EXTENSION, '').trim();
  }

  private addCandidate(candidates: string[], title: string): void {
    const safe = title
      .replace(/[&*\/<>:|?"\\]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    if (safe && safe.length <= 160 && !candidates.includes(safe)) {
      candidates.push(safe);
    }
  }

  private addBaseName(baseNames: string[], name: string): void {
    const clean = name.replace(REGION_TAGS, '').trim();
    if (clean !== name || !/[([](?:USA|Europe|Japan|World)[)\]]/i.test(name)) {
      this.addCandidate(baseNames, clean);
    }
  }

  private normalizedTitle(title: string): string {
    return this.romTitle(title)
      .replace(TRAILING_TAGS, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private detectRegion(name: string): string | null {
    if (/\b(?:Europe|EU)\b/i.test(name)) {
      return 'europe';
    }
    if (/\b(?:USA|US)\b/i.test(name)) {
      return 'usa';
    }
    if (/\b(?:Japan|JP)\b/i.test(name)) {
      return 'japan';
    }
    return null;
  }

  private scoreTitle(filename: string, needle: string, wantedRegion: string | null): number | null {
    const title = filename.slice(0, -4);
    const base = this.normalizedTitle(title);
    const score = this.titleScore(base, needle);
    if (score === null) {
      return null;
    }
    return score + (wantedRegion && this.detectRegion(title) === wantedRegion ? 20 : 0);
  }

  private titleScore(base: string, needle: string): number | null {
    // Do not match Alien 3 against Alien 3D, Alien 2 or a different game series.
    if (base === needle) {
      return 100;
    }
    if (base.startsWith(`${needle} `)) {
      return 60;
    }
    if (needle.length >= 4 && base.includes(` ${needle} `)) {
      return 30;
    }
    return null;
  }
}

function compareMatches(first: TitleMatch, second: TitleMatch): number {
  return second.score - first.score || first.filename.localeCompare(second.filename);
}
