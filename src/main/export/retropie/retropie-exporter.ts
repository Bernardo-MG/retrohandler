import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ExportFile, LibraryEntry } from '../../../shared';
import type { FileOperation } from '../../components/file-operations/file-operation';
import { FileOperationPlanner } from '../../components/file-operations/file-operation-planner';
import { childOf } from '../../components/filesystem/paths';
import { artworkPath, isArtworkId } from '../../metadata/artwork';
import type { Exporter, ExportTargetOptions } from '../exporter';
import type { ExportDraft } from '../prepared-export';
import { RetroPieGameList, type RetroPieGame } from './retropie-gamelist';
import { RetroPieLayout } from './retropie-layout';

const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_ART_BYTES = 5 * 1024 * 1024;

/** Prepares RetroPie configuration files; ROMs remain references only. */
export class RetroPieExporter implements Exporter {
  constructor(private readonly artworkFolder: string) { }

  async prepare(entries: readonly LibraryEntry[], options: ExportTargetOptions): Promise<ExportDraft> {
    const layout = new RetroPieLayout(options.overrides);
    const planner = new FileOperationPlanner(options.destination);
    const { files, warnings, bySystem } = await this.collectFiles(entries, options.includeArtwork, layout);
    // Artwork operations precede gamelists so new image references are published last.
    const artwork = await this.planArtwork(planner, files);
    const gamelists = await this.planGameLists(planner, layout, bySystem);
    return {
      plan: {
        files: [...files, ...gamelists.files],
        systems: [...bySystem.keys()].sort(),
        warnings,
        conflicts: [...artwork.conflicts, ...gamelists.conflicts],
        bytes: artwork.bytes,
        skippedRoms: entries.length - files.filter(file => file.kind === 'rom').length
      },
      operations: [...artwork.operations, ...gamelists.operations]
    };
  }

  private async collectFiles(entries: readonly LibraryEntry[], includeArtwork: boolean, layout: RetroPieLayout) {
    const files: ExportFile[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    const bySystem = new Map<string, RetroPieGame[]>();
    for (const entry of entries) {
      const rom = layout.resolveRom(entry);
      if ('warning' in rom) {
        warnings.push(rom.warning);
        continue;
      }
      const { system: mapped, filename: fileName, relativeDestination: dstRelative } = rom;
      const src = path.resolve(entry.source, entry.relativePath);
      if (!childOf(path.resolve(entry.source), src)) {
        warnings.push(`Unsafe source: ${entry.relativePath}`);
        continue;
      }
      const key = dstRelative.toLowerCase();
      if (seen.has(key)) {
        warnings.push(`Filename collision: ${dstRelative}`);
        continue;
      }
      const st = await lstat(src).catch(() => null);
      if (!st?.isFile()) {
        warnings.push(`Unavailable or linked source: ${entry.relativePath}`);
        continue;
      }
      const realSource = await realpath(src).catch(() => '');
      const realRoot = await realpath(entry.source).catch(() => '');
      if (!realRoot || !realSource || !childOf(realRoot, realSource)) {
        warnings.push(`Source escapes collection: ${entry.relativePath}`);
        continue;
      }
      seen.add(key);
      const file: ExportFile = {
        source: src,
        relativeDestination: dstRelative,
        size: st.size,
        kind: 'rom'
      };
      // A ROM entry is a gamelist reference only: it is never copied to the destination.
      files.push(file);
      let image: string | null = null;
      const id = entry.metadata?.artworkId;
      if (includeArtwork && isArtworkId(id)) {
        const imageDest = layout.artworkPath(mapped, id);
        const imageKey = imageDest.toLowerCase();
        const cached = artworkPath(this.artworkFolder, id);
        const artInfo = await lstat(cached).catch(() => null);
        if (artInfo?.isFile() && artInfo.size <= MAX_ART_BYTES) {
          image = id;
          if (!seen.has(imageKey)) {
            files.push({
              source: cached,
              relativeDestination: imageDest,
              size: artInfo.size,
              kind: 'artwork'
            });
            seen.add(imageKey);
          }
        } else {
          warnings.push(`Cached artwork unavailable: ${id}`);
        }
      }
      const group = bySystem.get(mapped) ?? [];
      group.push({ entry, filename: fileName, image });
      bySystem.set(mapped, group);
    }
    return { files, warnings, bySystem };
  }

  private async planArtwork(planner: FileOperationPlanner, files: readonly ExportFile[]) {
    const operations: FileOperation[] = [];
    const conflicts: string[] = [];
    // Existing artwork can be reused only when it is byte-identical. Never
    // overwrite a different image, even if its filename looks content-addressed.
    let bytes = 0;
    for (const item of files) {
      if (item.kind !== 'artwork') {
        continue;
      }
      try {
        const operation = await planner.planCopy(item.relativeDestination, item.source, item.size, MAX_ART_BYTES, 'artwork');
        operations.push(operation);
        if (operation.action === 'create') {
          bytes += operation.size;
        }
      } catch (error) {
        conflicts.push(`${item.relativeDestination}: ${String(error)}`);
      }
    }
    return { operations, conflicts, bytes };
  }

  private async planGameLists(planner: FileOperationPlanner, layout: RetroPieLayout, bySystem: ReadonlyMap<string, RetroPieGame[]>) {
    const files: ExportFile[] = [];
    const operations: FileOperation[] = [];
    const conflicts: string[] = [];
    for (const [system, group] of bySystem) {
      const relativeDestination = layout.gamelistPath(system);
      files.push({ source: '', relativeDestination, size: 0, kind: 'gamelist' });
      try {
        const gamelist = new RetroPieGameList(layout, system);
        const operation = await planner.planGenerated(relativeDestination, MAX_XML_BYTES,
          prior => gamelist.prepare(group, prior));
        operations.push(operation);
      } catch (error) {
        conflicts.push(`${relativeDestination}: ${String(error)}`);
      }
    }
    return { files, operations, conflicts };
  }
}
