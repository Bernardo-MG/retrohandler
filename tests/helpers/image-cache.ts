import { ImageCache } from '../../src/main/components/images';

export function createTestImageCache(root: string): ImageCache {
  return new ImageCache(root, {
    maxImageBytes: 5 * 1024 * 1024,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
    temporaryRetentionMs: 24 * 60 * 60 * 1000
  });
}
