import { detectImageFormat, type ImageFormat } from './image-format';

export class ImageValidationError extends Error {
  constructor(readonly reason: 'too-large' | 'unsupported-format') {
    super(reason === 'too-large' ? 'Image exceeds size limit.' : 'Image is not a supported image.');
  }
}

export function requireImageFormat(bytes: Buffer): ImageFormat {
  const format = detectImageFormat(bytes);
  if (!format) {
    throw new ImageValidationError('unsupported-format');
  }
  return format;
}

/** Apply a byte limit and signature policy, without decoding the image. */
export function validateImage(bytes: Buffer, maxBytes: number): ImageFormat {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Invalid image size limit.');
  }
  if (bytes.length > maxBytes) {
    throw new ImageValidationError('too-large');
  }
  return requireImageFormat(bytes);
}
