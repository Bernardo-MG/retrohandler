import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ExportOptions, ExportPlan, ExportReceipt, LibraryEntry } from '../../shared';
import { assertSafeDirectory, overlaps } from '../components/filesystem/paths';
import { executeOperations } from './export-executor';
import { finalizeExport, type PreparedExport } from './export-plan';
import type { Exporter } from './exporter';
import { readLibraryEntries, type ExportLibrary } from './library-reader';

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
      const { plan, operations } = await this.prepare(options);
      if (plan.fingerprint !== approvedFingerprint) {
        throw new Error('Export preview changed; preview again.');
      }
      if (plan.conflicts.length) {
        throw new Error('Resolve destination conflicts before export.');
      }
      if (!plan.files.some(file => file.kind === 'rom')) {
        throw new Error('No exportable ROMs in preview.');
      }
      return await executeOperations(plan.destination, operations);
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
    const entries = await readLibraryEntries(this.library, options.source);
    const destination = path.resolve(options.destination);
    await this.validateDestination(destination, entries, options.source);
    const draft = await this.exporter.prepare(entries, {
      destination,
      includeArtwork: options.includeArtwork,
      overrides: options.overrides
    });
    return finalizeExport(draft, options, destination);
  }

  private async validateDestination(destination: string, entries: readonly LibraryEntry[], source: string | null): Promise<void> {
    await assertSafeDirectory(destination);
    const roots = new Set(entries.map(entry => path.resolve(entry.source)));
    // Protect sources even if the selected collection happens to have zero indexed files.
    if (source) {
      roots.add(path.resolve(source));
    }
    const destinationKey = destination.toLowerCase();
    for (const root of roots) {
      if (overlaps(root.toLowerCase(), destinationKey)) {
        throw new Error('Export destination overlaps a ROM collection.');
      }
    }
    // The destination has no redirected ancestors. Also protect canonical source
    // roots, even if the requested destination parent does not exist yet.
    for (const root of roots) {
      const realRoot = await realpath(root).catch(() => root);
      if (overlaps(realRoot.toLowerCase(), destinationKey)) {
        throw new Error('Export destination overlaps a ROM collection.');
      }
    }
  }
}
