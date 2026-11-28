import path from 'node:path';
import type { Rom, ScanResult, ScanWarning } from '../../shared';
import { throwIfCancelled } from '../utils/cancellation';
import type { ScanOptions } from './scan-options';

const MAX_FILES = 250_000;
const PROGRESS_INTERVAL = 50;

function compareGames(left: Rom, right: Rom): number {
  return left.system.localeCompare(right.system) || left.name.localeCompare(right.name);
}

export class ScanJob {
  private readonly games: Rom[] = [];
  private readonly warnings: ScanWarning[] = [];
  private ignored = 0;
  private filesVisited = 0;
  private directoriesVisited = 0;

  constructor(
    readonly root: string,
    private readonly options: ScanOptions
  ) {}

  public get signal(): AbortSignal | undefined {
    return this.options.signal;
  }

  public checkCancellation(): void {
    throwIfCancelled(this.signal, 'Scan cancelled.');
  }

  public visitDirectory(): void {
    this.directoriesVisited++;
  }

  public visitFile(): void {
    this.filesVisited++;
  }

  public ignoreFile(): void {
    this.ignored++;
  }

  public addGame(game: Rom): void {
    this.games.push(game);
    if (this.games.length >= MAX_FILES) {
      throw new Error(
        `Scan limit (${MAX_FILES.toLocaleString()} files) reached. Select a smaller collection.`
      );
    }
  }

  public warn(filename: string, error: unknown): void {
    this.warnings.push({
      relativePath: path.relative(this.root, filename),
      message: error instanceof Error ? error.message : String(error)
    });
  }

  public reportFile(filename: string): void {
    if (this.filesVisited % PROGRESS_INTERVAL === 0) {
      this.report(filename);
    }
  }

  public report(currentPath: string): void {
    this.options.onProgress?.({
      filesVisited: this.filesVisited,
      gamesFound: this.games.length,
      directoriesVisited: this.directoriesVisited,
      ignored: this.ignored,
      warnings: this.warnings.length,
      currentPath
    });
  }

  public finish(): ScanResult {
    this.checkCancellation();
    this.games.sort(compareGames);
    this.report(this.root);
    this.checkCancellation();
    return {
      source: this.root,
      games: this.games,
      ignored: this.ignored,
      scannedAt: new Date().toISOString(),
      warnings: this.warnings
    };
  }
}
