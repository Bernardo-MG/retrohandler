import path from 'node:path';
import type { GameListRecord } from './gamelist-record';

export type PathMatch = { normalizedPath: string; record: GameListRecord };

/** A per-merge index of existing records; refuse uncertain or ambiguous matches. */
export class GameListRecordIndex {
  private readonly recordsByPath = new Map<string, PathMatch[]>();
  private readonly unresolvedBasenames = new Set<string>();

  constructor(records: readonly GameListRecord[], resolvePath: (value: string) => string | null) {
    for (const record of records) {
      const normalizedPath = resolvePath(record.path);
      if (normalizedPath === null) {
        // Block a possible duplicate rather than guessing a nonstandard path.
        this.unresolvedBasenames.add(path.posix.basename(record.path.trim().replace(/\\/g, '/')).toLowerCase());
        continue;
      }
      const matches = this.recordsByPath.get(normalizedPath.toLowerCase()) ?? [];
      matches.push({ normalizedPath, record });
      this.recordsByPath.set(normalizedPath.toLowerCase(), matches);
    }
  }

  public find(normalizedPath: string): PathMatch | undefined {
    if (this.unresolvedBasenames.has(path.posix.basename(normalizedPath).toLowerCase())) {
      throw new Error(`Unmapped existing ROM path may conflict: ${normalizedPath}`);
    }
    const matches = this.recordsByPath.get(normalizedPath.toLowerCase()) ?? [];
    if (!matches.length) {
      return undefined;
    }
    const [match] = matches;
    if (matches.length !== 1 || match.normalizedPath !== normalizedPath || match.record.kind !== 'game') {
      throw new Error(`Ambiguous existing ROM path: ${normalizedPath}`);
    }
    return match;
  }
}
