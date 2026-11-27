import { createHash } from 'node:crypto';
import { Crc32 } from './crc32';

export interface StreamFingerprint {
  crc32: string;
  md5: string;
  sha1: string;
  size: number;
}

export interface FileFingerprint extends StreamFingerprint {
  modifiedMs: number;
}

/** One incremental fingerprint calculation, without retaining its input. */
export class ContentFingerprint {
  private readonly crc = new Crc32();
  private readonly md5 = createHash('md5');
  private readonly sha1 = createHash('sha1');
  private bytes = 0;

  public get size(): number {
    return this.bytes;
  }

  public update(content: Uint8Array): void {
    this.crc.update(content);
    this.md5.update(content);
    this.sha1.update(content);
    this.bytes += content.length;
  }

  /** Finalize this calculation; like Node's Hash.digest(), call once. */
  public digest(): StreamFingerprint {
    return {
      crc32: this.crc.hex(),
      md5: this.md5.digest('hex'),
      sha1: this.sha1.digest('hex'),
      size: this.bytes
    };
  }
}
