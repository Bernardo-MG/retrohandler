import { sha256 } from '../hashing/content-hash';

export const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
export const isArtworkId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{64}\.(jpg|png|webp)$/.test(id);

type ImageExtension = 'jpg' | 'png' | 'webp';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MIME_TYPES: Record<ImageExtension, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

function imageExtension(bytes: Buffer): ImageExtension | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** Identify the supported image signature, not a caller-supplied filename or MIME type. */
export function identifyArtwork(bytes: Buffer): { id: string; mime: string } {
  if (bytes.length > MAX_ARTWORK_BYTES) {
    throw new Error('Artwork exceeds size limit.');
  }
  const extension = imageExtension(bytes);
  if (!extension) {
    throw new Error('Artwork is not a supported image.');
  }
  return { id: `${sha256(bytes)}.${extension}`, mime: MIME_TYPES[extension] };
}
