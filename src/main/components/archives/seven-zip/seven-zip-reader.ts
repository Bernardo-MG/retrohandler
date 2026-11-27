import type { Readable } from 'node:stream';
import type { ArchiveEntry, ArchiveReader } from '../archive-reader';
import { resolveSevenZipExecutable } from './seven-zip-executable';
import { parse7ZipListing } from './seven-zip-listing-parser';
import { SevenZipProcess } from './seven-zip-process';

/** List and stream supported archives using the configured 7-Zip executable. */
export class SevenZipReader implements ArchiveReader {
  private readonly process: SevenZipProcess;

  constructor(executable = resolveSevenZipExecutable()) {
    this.process = new SevenZipProcess(executable);
  }

  public async list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
    return parse7ZipListing(await this.process.list(filename, signal));
  }

  public open(filename: string, entryName: string, signal?: AbortSignal): Readable {
    return this.process.extract(filename, entryName, signal);
  }
}
