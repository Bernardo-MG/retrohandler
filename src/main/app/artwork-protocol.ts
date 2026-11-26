import { protocol } from 'electron';
import type { ArtworkCache } from '../components/artwork/artwork-cache';
import { isArtworkId } from '../components/artwork/artwork-image';

/** Adapt content-addressed artwork to the application's read-only protocol. */
export function registerArtworkProtocol(artwork: Pick<ArtworkCache, 'read'>): void {
  protocol.handle('retro-art', readArtwork);

  async function readArtwork(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.slice(1));
      if (url.hostname !== 'cover' || !isArtworkId(id) || url.search || url.hash) {
        return new Response('Not found', { status: 404 });
      }
      const art = await artwork.read(id);
      return new Response(new Uint8Array(art.body), {
        headers: { 'Content-Type': art.mime, 'Cache-Control': 'private, max-age=86400' }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
}
