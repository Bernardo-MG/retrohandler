import { ipcMain, shell } from 'electron';
import type { GameMetadataInput, MetadataTarget } from '../../shared';
import type { LibraryStore } from '../database/library-store';
import { downloadArtwork } from './artwork';
import { rawgProvider, type MetadataProvider } from './rawg';

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
  if (!['manual','rawg'].includes(String(input.provider))) throw new Error('Invalid provider.');
  for (const name of ['providerId', 'providerSlug', 'artworkId']) {
    if (input[name] !== null && typeof input[name] !== 'string') throw new Error('Invalid metadata fields.');
  }
  return input as unknown as GameMetadataInput;
}
export function registerMetadataIpc(store: LibraryStore, artworkFolder: string, provider: MetadataProvider = rawgProvider): void {
  if (!store.saveMetadata) throw new Error('Metadata storage unavailable.');
  ipcMain.handle('metadata:search', (_event, query: unknown, key: unknown) => {
    if (typeof query !== 'string' || typeof key !== 'string') throw new Error('Invalid metadata search.');
    return provider.search(query, key);
  });
  ipcMain.handle('metadata:apply', async (_event, input: unknown, id: unknown, key: unknown) => {
    const game = target(input);
    if (!Number.isSafeInteger(id) || Number(id) <= 0 || typeof key !== 'string') throw new Error('Invalid metadata request.');
    const details = await provider.detail(Number(id), key);
    let artworkId: string | null = null;
    if (details.imageUrl) {
      // Cover download failure does not discard useful text metadata.
      try { artworkId = await downloadArtwork(details.imageUrl, artworkFolder); } catch { /* no artwork */ }
    }
    return store.saveMetadata!(game.source, game.relativePath, { ...details.metadata, artworkId });
  });
  ipcMain.handle('metadata:save', (_event, input: unknown, data: unknown) => {
    const game = target(input);
    return store.saveMetadata!(game.source, game.relativePath, fields(data));
  });
  ipcMain.handle('metadata:open-source', (_event, slug: unknown) => {
    if (typeof slug !== 'string' || !/^[a-z0-9-]{1,150}$/.test(slug)) throw new Error('Invalid provider link.');
    return shell.openExternal(`https://rawg.io/games/${slug}`);
  });
}
