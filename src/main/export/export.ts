import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ExportOptions, ExportPlan, ExportReceipt, LibraryEntry, LibraryQuery, LibraryPage } from '../../shared';
import { assertSafeDirectory, overlaps } from '../components/filesystem/paths';
import { fingerprint, type PreparedExport } from './export-plan';
import { executeOperations } from './export-executor';
import type { Exporter } from './exporter';
import { RetroPieExporter } from './retropie/retropie-exporter';

export type ExportLibrary = {
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>
};
async function collect(library: ExportLibrary, source: string | null): Promise<LibraryEntry[]> {
  const all: LibraryEntry[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await library.queryLibrary({
      source,
      search: '',
      system: null,
      sort: 'name',
      descending: false,
      offset,
      limit: 200
    });
    all.push(...page.items);
    if (all.length >= page.total) {
      return all;
    }
    if (!page.items.length || all.length > 250000) {
      throw new Error('Library changed during export preview.');
    }
  }
}

/** Validate shared inputs and destination before invoking a target-specific strategy. */
export async function prepareExport(library: ExportLibrary, options: ExportOptions, exporter: Exporter): Promise<PreparedExport> {
  if (!path.isAbsolute(options.destination) || !options.destination.trim()) {
    throw new Error('Choose an absolute destination folder.');
  }
  if (options.source !== null && (!path.isAbsolute(options.source) || options.source.length > 4096)) {
    throw new Error('Invalid collection.');
  }
  if (typeof options.includeArtwork !== 'boolean' || !options.overrides || Array.isArray(options.overrides) || typeof options.overrides !== 'object') {
    throw new Error('Invalid export options.');
  }
  const entries = await collect(library, options.source);
  const dest = path.resolve(options.destination);
  await assertSafeDirectory(dest);
  const roots = [...new Set(entries.map(e => path.resolve(e.source)))];
  // Protect sources even if the selected collection happens to have zero indexed files.
  if (options.source) {
    roots.push(path.resolve(options.source));
  }
  for (const root of roots) if (overlaps(root.toLowerCase(), dest.toLowerCase())) {
    throw new Error('Export destination overlaps a ROM collection.');
  }
  // The destination has no redirected ancestors. Also protect canonical source
  // roots, even if the requested destination parent does not exist yet.
  for (const root of roots) {
    const realRoot = await realpath(root).catch(() => root);
    if (overlaps(realRoot.toLowerCase(), dest.toLowerCase())) {
      throw new Error('Export destination overlaps a ROM collection.');
    }
  }
  const draft = await exporter.prepare(entries, options, dest);
  const plan = { ...draft.plan, destination: dest };
  return { plan: { ...plan, fingerprint: fingerprint(plan, options, draft.operations) }, operations: draft.operations };
}

export async function previewExport(library: ExportLibrary, options: ExportOptions, artworkFolder: string): Promise<ExportPlan> {
  return (await prepareExport(library, options, new RetroPieExporter(artworkFolder))).plan;
}

let exporting = false;
export async function executeExport(
  library: ExportLibrary,
  options: ExportOptions,
  artworkFolder: string,
  approvedFingerprint: string
): Promise<ExportReceipt> {
  if (exporting) {
    throw new Error('Another configuration export is running.');
  }
  exporting = true;
  try {
    const { plan, operations } = await prepareExport(library, options, new RetroPieExporter(artworkFolder));
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
    exporting = false;
  }
}
