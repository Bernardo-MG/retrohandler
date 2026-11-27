import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Rom } from '../../shared';
import { sha256 } from '../components/hashing/content-hash';
import { inferPlatform } from './platforms';
import { isScannableRom } from '../rom/rom-formats';
import { assertUnredirectedPath } from '../components/filesystem/paths';
import { titleFromName } from './naming';

export class RomClassifier {
  public accepts(filename: string, tracks: ReadonlySet<string>): boolean {
    return isScannableRom(path.extname(filename)) && !this.isReferencedTrack(filename, tracks);
  }

  public async classify(root: string, filename: string): Promise<Rom> {
    await assertUnredirectedPath(root, filename);
    const info = await lstat(filename);
    if (!info.isFile()) {
      throw new Error('Not a regular ROM file.');
    }
    const relativePath = path.relative(root, filename);
    return {
      id: sha256(Buffer.from(relativePath)).slice(0, 16),
      name: titleFromName(path.basename(filename)),
      system: inferPlatform(relativePath),
      relativePath,
      extension: path.extname(filename).toLowerCase(),
      bytes: info.size
    };
  }

  private isReferencedTrack(filename: string, tracks: ReadonlySet<string>): boolean {
    return (
      path.extname(filename).toLowerCase() === '.bin' && tracks.has(path.basename(filename).toLowerCase())
    );
  }
}
