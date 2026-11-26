import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ExportFile, LibraryEntry } from '../../../shared';
import type { FileOperation } from '../../components/file-operations/file-operation';
import { FileOperationPlanner } from '../../components/file-operations/file-operation-planner';
import { childOf } from '../../components/filesystem/paths';
import type { ArtworkCache } from '../../components/artwork/artwork-cache';
import { isArtworkId, MAX_ARTWORK_BYTES } from '../../components/artwork/artwork-image';
import type { Exporter, ExportTargetOptions } from '../exporter';
import type { ExportDraft } from '../prepared-export';
import { RetroPieGameList, type RetroPieGame } from './retropie-gamelist';
import { RetroPieLayout } from './retropie-layout';

const MAX_XML_BYTES = 32 * 1024 * 1024;

/** Prepares RetroPie configuration files; ROMs remain references only. */
export class RetroPieExporter implements Exporter {
  constructor(private readonly artwork: ArtworkCache) { }

  prepareDraft(entries: readonly LibraryEntry[], options: ExportTargetOptions): Promise<ExportDraft> {
    return new RetroPieDraftBuilder(this.artwork, options).build(entries);
  }
}

/** Per-preview state. Separate previews never share collected files or operations. */
class RetroPieDraftBuilder {
  private readonly layout: RetroPieLayout;
  private readonly planner: FileOperationPlanner;
  private readonly includeArtwork: boolean;
  private readonly files: ExportFile[] = [];
  private readonly warnings: string[] = [];
  private readonly conflicts: string[] = [];
  private readonly operations: FileOperation[] = [];
  private readonly seenDestinations = new Set<string>();
  private readonly gamesBySystem = new Map<string, RetroPieGame[]>();
  private artworkBytes = 0;

  constructor(private readonly artwork: ArtworkCache, options: ExportTargetOptions) {
    this.layout = new RetroPieLayout(options.overrides);
    this.planner = new FileOperationPlanner(options.destination);
    this.includeArtwork = options.includeArtwork;
  }

  async build(entries: readonly LibraryEntry[]): Promise<ExportDraft> {
    for (const entry of entries) {
      await this.collectGame(entry);
    }
    // Artwork operations precede gamelists so new image references are published last.
    await this.planArtworkCopies();
    await this.planGameListWrites();
    return {
      plan: {
        files: this.files,
        systems: [...this.gamesBySystem.keys()].sort(),
        warnings: this.warnings,
        conflicts: this.conflicts,
        bytes: this.artworkBytes,
        skippedRoms: entries.length - this.files.filter(file => file.kind === 'rom').length
      },
      operations: this.operations
    };
  }

  private async collectGame(entry: LibraryEntry): Promise<void> {
    const rom = this.layout.resolveRomDestination(entry);
    if ('warning' in rom) {
      this.warnings.push(rom.warning);
      return;
    }
    if (!(await this.collectRomReference(entry, rom.relativeDestination))) {
      return;
    }
    const image = await this.collectArtwork(entry, rom.system);
    const games = this.gamesBySystem.get(rom.system) ?? [];
    games.push({ entry, filename: rom.filename, image });
    this.gamesBySystem.set(rom.system, games);
  }

  /** ROMs are references only: validate their sources, but never plan a copy. */
  private async collectRomReference(entry: LibraryEntry, relativeDestination: string): Promise<boolean> {
    const sourceRoot = path.resolve(entry.source);
    const sourcePath = path.resolve(sourceRoot, entry.relativePath);
    if (!childOf(sourceRoot, sourcePath)) {
      this.warnings.push(`Unsafe source: ${entry.relativePath}`);
      return false;
    }
    const destinationKey = relativeDestination.toLowerCase();
    if (this.seenDestinations.has(destinationKey)) {
      this.warnings.push(`Filename collision: ${relativeDestination}`);
      return false;
    }
    const info = await lstat(sourcePath).catch(() => null);
    if (!info?.isFile()) {
      this.warnings.push(`Unavailable or linked source: ${entry.relativePath}`);
      return false;
    }
    const realSource = await realpath(sourcePath).catch(() => '');
    const realRoot = await realpath(entry.source).catch(() => '');
    if (!realRoot || !realSource || !childOf(realRoot, realSource)) {
      this.warnings.push(`Source escapes collection: ${entry.relativePath}`);
      return false;
    }
    this.seenDestinations.add(destinationKey);
    this.files.push({ source: sourcePath, relativeDestination, size: info.size, kind: 'rom' });
    return true;
  }

  private async collectArtwork(entry: LibraryEntry, system: string): Promise<string | null> {
    const artworkId = entry.metadata?.artworkId;
    if (!this.includeArtwork || !isArtworkId(artworkId)) {
      return null;
    }
    const relativeDestination = this.layout.artworkDestination(system, artworkId);
    const destinationKey = relativeDestination.toLowerCase();
    const cached = await this.artwork.find(artworkId);
    if (!cached) {
      this.warnings.push(`Cached artwork unavailable: ${artworkId}`);
      return null;
    }
    if (!this.seenDestinations.has(destinationKey)) {
      this.files.push({ source: cached.path, relativeDestination, size: cached.size, kind: 'artwork' });
      this.seenDestinations.add(destinationKey);
    }
    return artworkId;
  }

  private async planArtworkCopies(): Promise<void> {
    // Existing artwork can be reused only when it is byte-identical.
    for (const file of this.files) {
      if (file.kind !== 'artwork') {
        continue;
      }
      await this.planArtworkCopy(file);
    }
  }

  private async planArtworkCopy(file: ExportFile): Promise<void> {
    try {
      const operation = await this.planner.planFileCopy({
        relativeDestination: file.relativeDestination,
        sourcePath: file.source,
        expectedSize: file.size,
        maxBytes: MAX_ARTWORK_BYTES,
        fileLabel: 'artwork'
      });
      this.operations.push(operation);
      if (operation.action === 'create') {
        this.artworkBytes += operation.size;
      }
    } catch (error) {
      this.conflicts.push(`${file.relativeDestination}: ${String(error)}`);
    }
  }

  private async planGameListWrites(): Promise<void> {
    for (const [system, games] of this.gamesBySystem) {
      await this.planGameListWrite(system, games);
    }
  }

  private async planGameListWrite(system: string, games: readonly RetroPieGame[]): Promise<void> {
    const relativeDestination = this.layout.gameListDestination(system);
    this.files.push({ source: '', relativeDestination, size: 0, kind: 'gamelist' });
    try {
      const gameList = new RetroPieGameList(this.layout, system);
      this.operations.push(await this.planner.planGeneratedFile({
        relativeDestination,
        maxBytes: MAX_XML_BYTES,
        generate: previousContent => gameList.generateOrMerge(games, previousContent)
      }));
    } catch (error) {
      this.conflicts.push(`${relativeDestination}: ${String(error)}`);
    }
  }
}
