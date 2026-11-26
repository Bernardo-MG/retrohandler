import { readRegular } from '../filesystem/file-reader';
import { sha256, sha256OrNull } from './content-hash';
import type { FileDestination } from './file-destination';
import type { FileOperation } from './file-operation';

type FileTarget = {
  relativeDestination: string;
  maxBytes: number;
};

type FileCopyRequest = FileTarget & {
  sourcePath: string;
  expectedSize: number;
  fileLabel: string;
};

type GeneratedFileRequest = FileTarget & {
  generate: (previousContent: Buffer | null) => Buffer;
};

/** Plans read-only operations within a configured destination. */
export class FileOperationPlanner {
  constructor(private readonly destination: FileDestination) {}

  /** Inspect a source file without retaining its bytes in the prepared export. */
  async planFileCopy(request: FileCopyRequest): Promise<FileOperation> {
    const { relativeDestination, sourcePath, expectedSize, maxBytes, fileLabel } = request;
    await this.destination.assertSafeParent(relativeDestination);
    const sourceContent = await readRegular(sourcePath, maxBytes);
    if (!sourceContent || sourceContent.length !== expectedSize) {
      throw new Error(`Cached ${fileLabel} changed; preview again.`);
    }
    const previousContent = await this.destination.readFile(relativeDestination, maxBytes);
    const outputHash = sha256(sourceContent);
    const previousHash = sha256OrNull(previousContent);
    if (previousHash !== null && previousHash !== outputHash) {
      throw new Error(`Existing ${fileLabel} differs from cached ${fileLabel}.`);
    }
    return {
      relativeDestination,
      content: { sourcePath },
      maxBytes,
      size: sourceContent.length,
      action: previousContent === null ? 'create' : 'reuse',
      previousHash,
      outputHash
    };
  }

  /** The consumer supplies the format-specific generation or merge policy. */
  async planGeneratedFile(request: GeneratedFileRequest): Promise<FileOperation> {
    const { relativeDestination, maxBytes, generate } = request;
    const previousContent = await this.destination.readFile(relativeDestination, maxBytes);
    const bytes = generate(previousContent);
    if (bytes.length > maxBytes) {
      throw new Error('Generated file exceeds size limit.');
    }
    const previousHash = sha256OrNull(previousContent);
    const outputHash = sha256(bytes);
    return {
      relativeDestination,
      content: { bytes },
      maxBytes,
      size: bytes.length,
      action: previousContent === null ? 'create' : previousHash === outputHash ? 'reuse' : 'update',
      previousHash,
      outputHash
    };
  }
}
