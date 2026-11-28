export interface ImageCacheOptions {
  maxImageBytes: number;
  retentionMs: number;
  temporaryRetentionMs: number;
}

export function validateImageCacheOptions(options: ImageCacheOptions): void {
  for (const limit of [options.maxImageBytes, options.retentionMs, options.temporaryRetentionMs]) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('Invalid image cache options.');
    }
  }
}
