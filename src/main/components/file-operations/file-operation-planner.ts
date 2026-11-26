import { readRegular } from '../filesystem/file-reader';
import { hash, hashOrNull } from './content-hash';
import type { FileDestination } from './file-destination';
import type { FileOperation } from './file-operation';

/** Plans read-only operations within a configured destination. */
export class FileOperationPlanner {
  constructor(private readonly destination: FileDestination) {}

  /** Inspect a source file without retaining its bytes in the prepared export. */
  async planCopy(
    relative: string,
    file: string,
    expectedSize: number,
    maxBytes: number,
    label: string
  ): Promise<FileOperation> {
    await this.destination.checkParent(relative);
    const source = await readRegular(file, maxBytes);
    if (!source || source.length !== expectedSize) {
      throw new Error(`Cached ${label} changed; preview again.`);
    }
    const prior = await this.destination.read(relative, maxBytes);
    const output = hash(source);
    const previous = hashOrNull(prior);
    if (previous !== null && previous !== output) {
      throw new Error(`Existing ${label} differs from cached ${label}.`);
    }
    return {
      relativeDestination: relative,
      content: { file },
      maxBytes,
      size: source.length,
      action: prior === null ? 'create' : 'reuse',
      previous,
      output
    };
  }

  /** The consumer supplies the format-specific generation or merge policy. */
  async planGenerated(
    relative: string,
    maxBytes: number,
    generate: (previous: Buffer | null) => Buffer
  ): Promise<FileOperation> {
    const prior = await this.destination.read(relative, maxBytes);
    const bytes = generate(prior);
    if (bytes.length > maxBytes) {
      throw new Error('Generated file exceeds size limit.');
    }
    const previous = hashOrNull(prior);
    const output = hash(bytes);
    return {
      relativeDestination: relative,
      content: { bytes },
      maxBytes,
      size: bytes.length,
      action: prior === null ? 'create' : previous === output ? 'reuse' : 'update',
      previous,
      output
    };
  }
}
