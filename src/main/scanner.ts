import type { ScanResult } from '../shared';
import { throwIfCancelled } from './components/async/cancellation';
import { DirectoryWalker, type DirectoryListing } from './components/filesystem/directory-walker';
import { assertUnredirectedPath } from './components/filesystem/paths';
import { DiscDescriptorReader } from './scanner/disc-descriptor-reader';
import { RomClassifier } from './scanner/rom-classifier';
import { ScanJob } from './scanner/scan-job';
import type { ScanOptions } from './scanner/scan-options';

export type { ScanOptions } from './scanner/scan-options';

const MAX_DEPTH = 15;

/** Read-only scanner. All mutable progress and results belong to a single scan job. */
export class RomScanner {
  constructor(
    private readonly walker = new DirectoryWalker(MAX_DEPTH),
    private readonly descriptors = new DiscDescriptorReader(),
    private readonly classifier = new RomClassifier()
  ) {}

  public async scan(folder: string, options: ScanOptions = {}): Promise<ScanResult> {
    throwIfCancelled(options.signal, 'Scan cancelled.');
    const job = new ScanJob(await this.walker.resolveRoot(folder), options);
    job.checkCancellation();
    job.report(job.root);
    try {
      for await (const listing of this.walker.walk(job.root, {
        signal: job.signal,
        onWarning: job.warn.bind(job),
        onDirectoryFinished: job.report.bind(job)
      })) {
        await this.scanDirectory(listing, job);
      }
    } catch (error) {
      job.checkCancellation();
      throw error;
    }
    return job.finish();
  }

  private async scanDirectory(listing: DirectoryListing, job: ScanJob): Promise<void> {
    job.visitDirectory();
    const tracks = await this.collectTracks(listing.files, job);
    for (const filename of listing.files) {
      job.checkCancellation();
      await this.scanFile(filename, tracks, job);
    }
  }

  private async collectTracks(files: readonly string[], job: ScanJob): Promise<Set<string>> {
    const tracks = new Set<string>();
    for (const filename of files) {
      job.checkCancellation();
      if (!this.descriptors.supports(filename)) {
        continue;
      }
      for (const track of await this.readDescriptorTracks(filename, job)) {
        tracks.add(track);
      }
    }
    return tracks;
  }

  private async readDescriptorTracks(filename: string, job: ScanJob): Promise<ReadonlySet<string>> {
    try {
      await assertUnredirectedPath(job.root, filename);
      const tracks = await this.descriptors.readTracks(filename);
      await assertUnredirectedPath(job.root, filename);
      return tracks;
    } catch (error) {
      job.checkCancellation();
      job.warn(filename, error);
      return new Set();
    }
  }

  private async scanFile(filename: string, tracks: ReadonlySet<string>, job: ScanJob): Promise<void> {
    job.visitFile();
    if (this.classifier.accepts(filename, tracks)) {
      await this.collectGame(filename, job);
    } else {
      job.ignoreFile();
    }
    job.reportFile(filename);
  }

  private async collectGame(filename: string, job: ScanJob): Promise<void> {
    let game;
    try {
      game = await this.classifier.classify(job.root, filename);
    } catch (error) {
      job.checkCancellation();
      job.warn(filename, error);
      return;
    }
    job.addGame(game);
  }
}
