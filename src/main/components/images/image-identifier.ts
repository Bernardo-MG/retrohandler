import { sha256 } from '../../utils/hashing';
import { requireImageFormat } from './image-validation';

export const isImageId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{64}\.(jpg|png|webp)$/.test(id);

/** Preserve content addresses independently of a cache's size or retention policy. */
export function createImageId(bytes: Buffer): string {
  const { extension } = requireImageFormat(bytes);
  return `${sha256(bytes)}.${extension}`;
}
