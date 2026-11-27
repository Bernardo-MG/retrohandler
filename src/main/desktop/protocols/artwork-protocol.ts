import { protocol } from 'electron';
import { isImageId, type ImageCache } from '../../components/images';

export function registerArtworkScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'retro-art', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);
}

/** Adapt content-addressed artwork to the application's read-only protocol. */
export function registerArtworkProtocol(artwork: Pick<ImageCache, 'read'>): void {
  protocol.handle('retro-art', readArtwork);

  async function readArtwork(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.slice(1));
      if (url.hostname !== 'cover' || !isImageId(id) || url.search || url.hash) {
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
