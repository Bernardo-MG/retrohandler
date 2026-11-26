import { readRegular } from '../filesystem/file-reader';
import type { FileWriter } from '../filesystem/file-writer';
import { sha256, sha256OrNull } from '../hashing/content-hash';
import type { FileDestination } from './file-destination';
import type { FileOperation, FileOperationReceipt } from './file-operation';

/** Execute approved operations in order without depending on export models. */
export class FileOperationExecutor {
  constructor(
    private readonly destination: FileDestination,
    private readonly writer: FileWriter
  ) {}

  async execute(operations: readonly FileOperation[]): Promise<FileOperationReceipt> {
    let writtenCount = 0;
    const backups: string[] = [];
    const recordBackup = (backup: string): void => {
      backups.push(this.destination.relativePathOf(backup));
    };
    try {
      for (const operation of operations) {
        if (await this.executeOperation(operation, recordBackup)) {
          writtenCount++;
        }
      }
    } catch (error) {
      if (writtenCount || backups.length) {
        throw new Error(`Export stopped after ${writtenCount} file(s) written. Backups: ${backups.join(', ') || 'none'}. Preview again before retrying. ${String(error)}`);
      }
      throw error;
    }
    return backups.length ? { copied: writtenCount, backups } : { copied: writtenCount };
  }

  private async executeOperation(operation: FileOperation, onBackup: (file: string) => void): Promise<boolean> {
    const { relativeDestination, maxBytes, previousHash, outputHash, action } = operation;
    const targetPath = await this.destination.ensureParentDirectory(relativeDestination);
    const previousContent = await this.destination.readFile(relativeDestination, maxBytes);
    if (sha256OrNull(previousContent) !== previousHash) {
      throw new Error(`Destination changed; preview again: ${relativeDestination}`);
    }
    const newContent = await this.readApprovedContent(operation);
    switch (action) {
      case 'reuse':
        if (previousContent !== null && previousHash === outputHash) {
          return false;
        }
        break;
      case 'create':
        if (previousContent === null) {
          await this.writer.createExclusive(targetPath, newContent);
          return true;
        }
        break;
      case 'update':
        if (previousContent !== null) {
          await this.writer.replaceWithBackup({
            targetPath,
            newContent,
            approvedContent: previousContent,
            maxBytes,
            onBackup
          });
          return true;
        }
        break;
    }
    throw new Error('Invalid export job.');
  }

  private async readApprovedContent(operation: FileOperation): Promise<Buffer> {
    const { content, maxBytes, outputHash, relativeDestination } = operation;
    const bytes = 'bytes' in content ? content.bytes : await readRegular(content.sourcePath, maxBytes);
    if (!bytes || bytes.length > maxBytes || sha256(bytes) !== outputHash) {
      throw new Error(`Source changed; preview again: ${relativeDestination}`);
    }
    return bytes;
  }
}
