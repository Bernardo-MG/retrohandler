import { dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { GameMetadataInput, MetadataTarget } from '../../shared';
import type { ArtworkProvider, CoverLookup, CoverSearch, MetadataSearch, MetadataService } from '../metadata';
import type { LaunchBoxCatalogueUpdater, LaunchBoxUpdate } from '../metadata/launchbox/launchbox-catalogue-updater';

type MetadataIpcDependencies = {
  metadata: MetadataService;
  artwork: ArtworkProvider;
  launchBox: LaunchBoxCatalogueUpdater;
};

function isText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit;
}

function isPathText(value: unknown): value is string {
  return isText(value, 4096) && value.length > 0;
}

function parseTarget(value: unknown): MetadataTarget {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid metadata target.');
  }
  const entry = value as Record<string, unknown>;
  if (!isPathText(entry.source) || !isPathText(entry.relativePath)) {
    throw new Error('Invalid metadata target.');
  }
  return { source: entry.source, relativePath: entry.relativePath };
}

function parseFields(value: unknown): GameMetadataInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid metadata fields.');
  }
  const input = value as Record<string, unknown>;
  assertMetadataText(input);
  assertMetadataProvider(input);
  assertSystemOverride(input.systemOverride);
  return input as unknown as GameMetadataInput;
}

function assertMetadataText(input: Record<string, unknown>): void {
  for (const name of ['title', 'description', 'released', 'developer', 'publisher', 'genre']) {
    if (typeof input[name] !== 'string') {
      throw new Error('Invalid metadata fields.');
    }
  }
  for (const name of ['providerId', 'providerSlug', 'artworkId']) {
    if (input[name] !== null && typeof input[name] !== 'string') {
      throw new Error('Invalid metadata fields.');
    }
  }
}

function assertMetadataProvider(input: Record<string, unknown>): void {
  if (input.provider !== 'manual' && input.provider !== 'launchbox') {
    throw new Error('Invalid provider.');
  }
}

function assertSystemOverride(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!isText(value, 120) || !value.trim()) {
    throw new Error('Invalid system override.');
  }
}

function parseMetadataSearch(query: unknown, system: unknown): MetadataSearch {
  if (!isText(query, 120) || !isText(system, 120)) {
    throw new Error('Invalid LaunchBox search.');
  }
  return { query, system };
}

function parseCandidateId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Invalid LaunchBox match.');
  }
  return id;
}

function isCoverName(value: unknown): value is string {
  return isText(value, 200);
}

function parseCoverLookup(system: unknown, names: unknown): CoverLookup {
  if (!isText(system, 120) || !Array.isArray(names) || names.length > 3 || !names.every(isCoverName)) {
    throw new Error('Invalid artwork search.');
  }
  return { system, names };
}

function parseCoverSearch(system: unknown, query: unknown, regionHint: unknown, refresh: unknown): CoverSearch {
  if (!isText(system, 120) || !isText(query, 120) || !isText(regionHint, 200) || typeof refresh !== 'boolean') {
    throw new Error('Invalid Libretro cover search.');
  }
  return { system, query, regionHint, refresh };
}

/** Electron sender ownership and dialog/progress adaptation only. */
class LaunchBoxIpc {
  private readonly updates = new Map<number, AbortController>();

  constructor(private readonly updater: LaunchBoxCatalogueUpdater) {}

  register(): void {
    ipcMain.handle('launchbox:download', event => this.download(event));
    ipcMain.handle('launchbox:cancel', event => this.cancel(event.sender.id));
    ipcMain.handle('launchbox:import', () => this.importFile());
  }

  private async download(event: IpcMainInvokeEvent): Promise<{ count: number }> {
    this.assertIdle();
    const sender = event.sender;
    const senderId = sender.id;
    const controller = new AbortController();
    const onDestroyed = () => controller.abort();
    this.updates.set(senderId, controller);
    sender.once('destroyed', onDestroyed);
    try {
      const count = await this.updater.download({
        signal: controller.signal,
        onProgress: update => this.sendProgress(sender, update)
      });
      return { count };
    } finally {
      sender.removeListener('destroyed', onDestroyed);
      this.updates.delete(senderId);
    }
  }

  private cancel(senderId: number): boolean {
    const controller = this.updates.get(senderId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  private async importFile(): Promise<{ count: number } | null> {
    this.assertIdle();
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'LaunchBox Metadata XML', extensions: ['xml'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return null;
    }
    // The updater acquires its lock again after the asynchronous file dialog.
    return { count: await this.updater.importFile(selection.filePaths[0]) };
  }

  private assertIdle(): void {
    if (this.updater.isUpdating) {
      throw new Error('A LaunchBox import is already running.');
    }
  }

  private sendProgress(sender: WebContents, update: LaunchBoxUpdate): void {
    if (!sender.isDestroyed()) {
      sender.send('launchbox:progress', update);
    }
  }
}

export function registerMetadataIpc({ metadata, artwork, launchBox }: MetadataIpcDependencies): void {
  new LaunchBoxIpc(launchBox).register();
  ipcMain.handle('launchbox:search', (_event, query: unknown, system: unknown) =>
    metadata.search(parseMetadataSearch(query, system)));
  ipcMain.handle('launchbox:apply', (_event, input: unknown, id: unknown) =>
    metadata.applyCandidate(parseTarget(input), parseCandidateId(id)));
  ipcMain.handle('libretro:artwork', (_event, system: unknown, names: unknown) =>
    artwork.findCover(parseCoverLookup(system, names)));
  ipcMain.handle('libretro:search-covers', (_event, system: unknown, query: unknown, regionHint: unknown, refresh: unknown) =>
    artwork.searchCovers(parseCoverSearch(system, query, regionHint, refresh)));
  ipcMain.handle('metadata:save', (_event, input: unknown, data: unknown) =>
    metadata.save(parseTarget(input), parseFields(data)));
}
