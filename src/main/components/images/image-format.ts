export type ImageExtension = 'jpg' | 'png' | 'webp';

export interface ImageFormat {
  extension: ImageExtension;
  mime: string;
}

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

/** Recognize supported image signatures; this does not decode or validate pixels. */
export function detectImageFormat(bytes: Buffer): ImageFormat | null {
  const extension = imageExtension(bytes);
  return extension ? { extension, mime: MIME_TYPES[extension] } : null;
}
