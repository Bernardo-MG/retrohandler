import { dialog, ipcMain } from 'electron';
import type { GameMetadataInput, MetadataTarget } from '../../shared';
import type { LaunchBoxRepository, MetadataRepository } from '../contracts/persistence';
import { importLaunchBoxXml } from './launchbox';
import { downloadLaunchBox } from './launchbox-download';
import { findLibretroCover, searchLibretroCovers } from './libretro';

function target(value: unknown): MetadataTarget {
  if (!value || typeof value !== 'object') throw new Error('Invalid metadata target.');
  const entry = value as Record<string, unknown>;
  if (typeof entry.source !== 'string' || !entry.source || entry.source.length > 4096 ||
      typeof entry.relativePath !== 'string' || !entry.relativePath || entry.relativePath.length > 4096) {
    throw new Error('Invalid metadata target.');
  }
  return { source: entry.source, relativePath: entry.relativePath };
}
function fields(value: unknown): GameMetadataInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid metadata fields.');
  const input = value as Record<string, unknown>;
  for (const name of ['title','description','released','developer','publisher','genre']) {
    if (typeof input[name] !== 'string') throw new Error('Invalid metadata fields.');
  }
  if (!['manual','launchbox'].includes(String(input.provider))) throw new Error('Invalid provider.');
  for (const name of ['providerId', 'providerSlug', 'artworkId']) {
    if (input[name] !== null && typeof input[name] !== 'string') throw new Error('Invalid metadata fields.');
  }
  if (input.systemOverride !== undefined && input.systemOverride !== null &&
      (typeof input.systemOverride !== 'string' || !input.systemOverride.trim() || input.systemOverride.length > 120))
    throw new Error('Invalid system override.');
  return input as unknown as GameMetadataInput;
}
export function registerMetadataIpc(
  metadata: MetadataRepository,
  launchBox: LaunchBoxRepository,
  artworkFolder: string
): void {
  let importing = false;
  const updates = new Map<number, AbortController>();
  ipcMain.handle('launchbox:download', async event => {
    if (importing) throw new Error('A LaunchBox import is already running.');
    importing = true;
    const sender = event.sender;
    const controller = new AbortController();
    updates.set(sender.id, controller);
    const onDestroyed = () => controller.abort();
    sender.once('destroyed', onDestroyed);
    try {
      const count = await downloadLaunchBox(launchBox, { signal: controller.signal, onProgress: update => {
        if (!sender.isDestroyed()) sender.send('launchbox:progress', update);
      } });
      return { count };
    } finally {
      sender.removeListener('destroyed', onDestroyed);
      updates.delete(sender.id);
      importing = false;
    }
  });
  ipcMain.handle('launchbox:cancel', event => {
    const controller = updates.get(event.sender.id);
    if (!controller) return false;
    controller.abort();
    return true;
  });
  ipcMain.handle('launchbox:import', async () => {
    if (importing) throw new Error('A LaunchBox import is already running.');
    const selection = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{name:'LaunchBox Metadata XML',extensions:['xml']}] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    importing = true;
    try { return { count: await importLaunchBoxXml(selection.filePaths[0], launchBox) }; }
    finally { importing = false; }
  });
  ipcMain.handle('launchbox:search', (_event, query: unknown, system: unknown) => {
    if (typeof query !== 'string' || query.length > 120 || typeof system !== 'string' || system.length > 120)
      throw new Error('Invalid LaunchBox search.');
    return launchBox.searchLaunchBox(query, system);
  });
  ipcMain.handle('launchbox:apply', (_event, input: unknown, id: unknown) => {
    const game = target(input);
    if (!Number.isSafeInteger(id) || Number(id) <= 0) throw new Error('Invalid LaunchBox match.');
    const found = launchBox.getLaunchBoxGame(Number(id));
    if (!found) throw new Error('LaunchBox game was not found in the imported catalogue.');
    // Never change the system assignment; preserve cached cover art when possible.

    return metadata.saveMetadata(game.source, game.relativePath, {
      title: found.title, description: found.description, released: found.released,
      developer: found.developer, publisher: found.publisher, genre: found.genre,
      provider:'launchbox', providerId:String(found.id), providerSlug:null,
      artworkId: metadata.getArtworkId(game.source, game.relativePath)
    });
  });
  ipcMain.handle('libretro:artwork', async (_event, system: unknown, names: unknown) => {
    if (typeof system !== 'string' || system.length > 120 || !Array.isArray(names) || names.length > 3 ||
        names.some(name => typeof name !== 'string' || name.length > 200)) throw new Error('Invalid artwork search.');
    return findLibretroCover(system, names as string[], artworkFolder);
  });
  ipcMain.handle('libretro:search-covers', async (_event, system: unknown, query: unknown, regionHint: unknown, refresh: unknown) => {
    if (typeof system !== 'string' || system.length > 120 || typeof query !== 'string' || query.length > 120 ||
        typeof regionHint !== 'string' || regionHint.length > 200 || typeof refresh !== 'boolean')
      throw new Error('Invalid Libretro cover search.');
    return searchLibretroCovers(system, query, regionHint, artworkFolder, refresh);
  });
  ipcMain.handle('metadata:save', (_event, input: unknown, data: unknown) => {
    const game = target(input);
    return metadata.saveMetadata(game.source, game.relativePath, fields(data));
  });
}
