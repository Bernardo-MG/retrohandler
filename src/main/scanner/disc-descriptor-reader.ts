import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { readRegular } from '../components/filesystem/file-reader';

const MAX_DESCRIPTOR_BYTES = 1024 * 1024;
const CUE_TRACK = /^\s*FILE\s+(?:"([^"]+)"|([^\s]+))\s+/i;
const GDI_TRACK = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))\s+\d+/i;

/** Descriptor references are names only; never open a referenced track. */
export class DiscDescriptorReader {
  supports(filename: string): boolean {
    return /\.(cue|gdi)$/i.test(filename);
  }

  async readTracks(filename: string): Promise<Set<string>> {
    const info = await lstat(filename);
    if (info.size > MAX_DESCRIPTOR_BYTES) {
      throw new Error('Disc descriptor exceeds 1 MiB.');
    }
    const content = await readRegular(filename, MAX_DESCRIPTOR_BYTES);
    if (content === null) {
      throw new Error('Disc descriptor unavailable.');
    }
    return this.parseTracks(path.extname(filename).toLowerCase(), content.toString('utf8'));
  }

  parseTracks(extension: string, contents: string): Set<string> {
    extension = extension.toLowerCase();
    if (extension !== '.cue' && extension !== '.gdi') {
      return new Set();
    }
    const lines = contents.split(/\r?\n/);
    const pattern = extension === '.cue' ? CUE_TRACK : GDI_TRACK;
    const tracks = new Set<string>();
    for (const line of extension === '.cue' ? lines : lines.slice(1)) {
      const match = pattern.exec(line);
      const name = match?.[1] ?? match?.[2];
      if (name && this.isLocalName(name)) {
        tracks.add(name.toLowerCase());
      }
    }
    return tracks;
  }

  private isLocalName(name: string): boolean {
    return name !== '.' && name !== '..' && name === path.posix.basename(name) && name === path.win32.basename(name);
  }
}
