import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const isArtworkId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}\.(jpg|png|webp)$/.test(id);
function typeFromBytes(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
export function artworkPath(root: string, id: string): string {
  if (!isArtworkId(id)) throw new Error('Invalid artwork ID.');
  return path.join(root, id);
}
export async function downloadArtwork(urlString: string, folder: string): Promise<string> {
  const url = new URL(urlString);
  // Only RAWG's image CDN is permitted; no redirects or arbitrary network addresses.
  if (url.protocol !== 'https:' || url.hostname !== 'media.rawg.io' || url.port || url.username || url.password) {
    throw new Error('Untrusted artwork URL.');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new Error(`Artwork fetch failed (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Artwork exceeds size limit.');
  const chunks: Buffer[] = [];
  let count = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    count += buffer.length;
    if (count > MAX_IMAGE_BYTES) { await response.body.cancel().catch(() => {}); throw new Error('Artwork exceeds size limit.'); }
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks);
  return cacheArtworkBytes(bytes, folder);
}

/** Cache only verified image bytes in the same content-addressed artwork store. */
export async function cacheArtworkBytes(bytes: Buffer, folder: string): Promise<string> {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Artwork exceeds size limit.');
  const extension = typeFromBytes(bytes);
  if (!extension) throw new Error('Artwork is not a supported image.');
  const id = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  await mkdir(folder, { recursive: true });
  const target = artworkPath(folder, id);
  const temp = path.join(folder, `.download-${randomUUID()}`);
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, target);
  } finally { await rm(temp, { force: true }); }
  return id;
}
export async function getArtwork(root: string, id: string): Promise<{ body: Buffer; mime: string }> {
  const file = artworkPath(root, id);
  const body = await readFile(file);
  if (body.length > MAX_IMAGE_BYTES || typeFromBytes(body) !== id.split('.').at(-1)) throw new Error('Invalid cached artwork.');
  const mime = id.endsWith('.png') ? 'image/png' : id.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return { body, mime };
}
