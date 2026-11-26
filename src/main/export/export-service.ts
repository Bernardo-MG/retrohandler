import path from 'node:path';
import type { ExportOptions, ExportPlan, ExportReceipt, LibraryEntry, LibraryPage, LibraryQuery } from '../../shared';
import { FileDestination } from '../components/file-operations/file-destination';
import { FileOperationExecutor } from '../components/file-operations/file-operation-executor';
import { FileWriter } from '../components/filesystem/file-writer';
import type { Exporter } from './exporter';
import { PreparedExport } from './prepared-export';

export type ExportLibrary = {
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>
};

const PAGE_SIZE = 200;
const MAX_ENTRIES = 250000;

/** Owns the preview/confirmation workflow. Share one instance for export concurrency control. */
export class ExportService {
  private exporting = false;

  constructor(
    private readonly library: ExportLibrary,
    private readonly exporter: Exporter
  ) { }

  async preview(options: ExportOptions): Promise<ExportPlan> {
    return (await this.prepare(options)).plan;
  }

  async execute(options: ExportOptions, approvedFingerprint: string): Promise<ExportReceipt> {
    if (this.exporting) {
      throw new Error('Another configuration export is running.');
    }
    this.exporting = true;
    try {
      const prepared = await this.prepare(options);
      prepared.confirm(approvedFingerprint);
      const executor = new FileOperationExecutor(prepared.destination, new FileWriter('retrohandler'));
      return await executor.execute(prepared.operations);
    } finally {
      this.exporting = false;
    }
  }

  /** Validate shared inputs and destination before invoking a target-specific strategy. */
  private async prepare(options: ExportOptions): Promise<PreparedExport> {
    if (!path.isAbsolute(options.destination) || !options.destination.trim()) {
      throw new Error('Choose an absolute destination folder.');
    }
    if (options.source !== null && (!path.isAbsolute(options.source) || options.source.length > 4096)) {
      throw new Error('Invalid collection.');
    }
    if (typeof options.includeArtwork !== 'boolean' || !options.overrides || Array.isArray(options.overrides) || typeof options.overrides !== 'object') {
      throw new Error('Invalid export options.');
    }
    const entries = await this.readLibraryEntries(options.source);
    const destination = new FileDestination(options.destination);
    const roots = entries.map(entry => entry.source);
    // Protect the selected collection even when it contains no indexed files.
    if (options.source) roots.push(options.source);
    await destination.validate(roots, 'Export destination overlaps a ROM collection.');
    const draft = await this.exporter.prepare(entries, {
      destination,
      includeArtwork: options.includeArtwork,
      overrides: options.overrides
    });
    return PreparedExport.fromDraft(draft, options, destination);
  }

  private async readLibraryEntries(source: string | null): Promise<LibraryEntry[]> {
    const all: LibraryEntry[] = [];
    for (; ;) {
      const page = await this.library.queryLibrary({
        source,
        search: '',
        system: null,
        sort: 'name',
        descending: false,
        offset: all.length,
        limit: PAGE_SIZE
      });
      if (page.total > MAX_ENTRIES || all.length + page.items.length > MAX_ENTRIES) {
        throw new Error('Library changed during export preview.');
      }
      all.push(...page.items);
      if (all.length >= page.total) {
        return all;
      }
      if (!page.items.length) {
        throw new Error('Library changed during export preview.');
      }
    }
  }
}
