import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { readRegular } from '../filesystem/file-reader';
import { assertSafeDirectory, ensureSafeDirectory } from '../filesystem/paths';
import { temporaryImageName } from './image-cache-files';
import { createImageId, isImageId } from './image-identifier';
import { validateImage } from './image-validation';

export interface CachedImage {
  body: Buffer;
  mime: string;
}

export interface ImageFile {
  path: string;
  size: number;
}

/** Content-addressed image storage, independent of cache retention policies. */
export class ImageStore {
  constructor(
    private readonly root: string,
    private readonly maxImageBytes: number
  ) {}

  public pathFor(id: string): string {
    if (!isImageId(id)) {
      throw new Error('Invalid image ID.');
    }
    return path.join(this.root, id);
  }

  public async store(bytes: Buffer): Promise<string> {
    validateImage(bytes, this.maxImageBytes);
    const id = createImageId(bytes);
    await ensureSafeDirectory(this.root);
    const temp = path.join(this.root, temporaryImageName());
    // Only remove a temporary file after this call successfully creates it.
    const handle = await open(temp, 'wx');
    try {
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      await assertSafeDirectory(this.root);
      await rename(temp, this.pathFor(id));
    } finally {
      await rm(temp, { force: true });
    }
    return id;
  }

  public async read(id: string): Promise<CachedImage> {
    const file = this.pathFor(id);
    await assertSafeDirectory(this.root);
    try {
      const body = await readRegular(file, this.maxImageBytes);
      if (body === null) {
        throw new Error('Image is absent.');
      }
      const { mime } = validateImage(body, this.maxImageBytes);
      if (createImageId(body) !== id) {
        throw new Error('Image identity changed.');
      }
      return { body, mime };
    } catch {
      throw new Error('Invalid cached image.');
    }
  }

  /** Locate a bounded regular file; unlike read(), this does not authenticate its contents. */
  public async locate(id: string): Promise<ImageFile | null> {
    const file = this.pathFor(id);
    try {
      await assertSafeDirectory(this.root);
      const info = await lstat(file);
      return info.isFile() && info.size <= this.maxImageBytes ? { path: file, size: info.size } : null;
    } catch {
      return null;
    }
  }
}
