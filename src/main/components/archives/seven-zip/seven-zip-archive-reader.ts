import type { Readable } from 'node:stream';
import type { ArchiveEntry } from '../archive-entry';
import type { ArchiveFormatReader } from '../archive-reader';
import { resolveSevenZipExecutable } from './seven-zip-executable';
import { parse7ZipListing } from './seven-zip-listing-parser';
import { SevenZipProcess } from './seven-zip-process';

/** List and stream supported archives using the configured 7-Zip executable. */
export class SevenZipArchiveReader implements ArchiveFormatReader {
  private readonly process: SevenZipProcess;

  constructor(executable = resolveSevenZipExecutable()) {
    this.process = new SevenZipProcess(executable);
  }

  public supports(extension: string): boolean {
    return ['.zip', '.rar', '.7z'].includes(extension.toLowerCase());
  }

  public async list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
    return parse7ZipListing(await this.process.list(filename, signal));
  }

  public async open(filename: string, entryName: string, signal?: AbortSignal): Promise<Readable> {
    return this.process.extract(filename, entryName, signal);
  }
}
