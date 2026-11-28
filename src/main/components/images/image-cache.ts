import path from 'node:path';
import {
  ImageCacheMaintenance,
  type ImageCacheCleanup,
  type ImageCacheStatistics
} from './image-cache-maintenance';
import { validateImageCacheOptions, type ImageCacheOptions } from './image-cache-options';
import { ImageStore, type CachedImage, type ImageFile } from './image-store';

/** Public facade for storage and cache maintenance under a configured policy. */
export class ImageCache {
  public readonly root: string;
  public readonly maxImageBytes: number;
  private readonly images: ImageStore;
  private readonly maintenance: ImageCacheMaintenance;

  constructor(root: string, options: ImageCacheOptions) {
    validateImageCacheOptions(options);
    this.root = path.resolve(root);
    this.maxImageBytes = options.maxImageBytes;
    this.images = new ImageStore(this.root, this.maxImageBytes);
    this.maintenance = new ImageCacheMaintenance(
      this.root,
      options.retentionMs,
      options.temporaryRetentionMs
    );
  }

  public pathFor(id: string): string {
    return this.images.pathFor(id);
  }

  public store(bytes: Buffer): Promise<string> {
    return this.images.store(bytes);
  }

  public read(id: string): Promise<CachedImage> {
    return this.images.read(id);
  }

  public locate(id: string): Promise<ImageFile | null> {
    return this.images.locate(id);
  }

  public inspect(referenced: ReadonlySet<string>, now = Date.now()): ImageCacheStatistics {
    return this.maintenance.inspect(referenced, now);
  }

  public cleanup(referenced: ReadonlySet<string>, now = Date.now()): ImageCacheCleanup {
    return this.maintenance.cleanup(referenced, now);
  }
}
