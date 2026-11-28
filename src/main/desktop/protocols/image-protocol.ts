import { protocol } from 'electron';
import { isImageId, type ImageCache } from '../../components/images';

export interface ImageProtocolOptions {
  scheme: string;
  hostname: string;
  maxAgeSeconds: number;
}

export function registerImageScheme(scheme: string): void {
  protocol.registerSchemesAsPrivileged([
    { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);
}

/** Serve content-addressed images through a read-only Electron protocol. */
export function registerImageProtocol(images: Pick<ImageCache, 'read'>, options: ImageProtocolOptions): void {
  const { scheme, hostname, maxAgeSeconds } = options;
  protocol.handle(scheme, readImage);

  async function readImage(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.slice(1));
      if (url.hostname !== hostname || !isImageId(id) || url.search || url.hash) {
        return new Response('Not found', { status: 404 });
      }
      const image = await images.read(id);
      return new Response(new Uint8Array(image.body), {
        headers: { 'Content-Type': image.mime, 'Cache-Control': `private, max-age=${maxAgeSeconds}` }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
}
