import { readRegular } from '../filesystem/file-reader';
import type { FileWriter } from '../filesystem/file-writer';
import { hash, hashOrNull } from './content-hash';
import type { FileDestination } from './file-destination';
import type { FileOperation, FileOperationReceipt } from './file-operation';

/** Execute approved operations in order without depending on export models. */
export class FileOperationExecutor {
  constructor(
    private readonly destination: FileDestination,
    private readonly writer: FileWriter
  ) {}

  async execute(operations: readonly FileOperation[]): Promise<FileOperationReceipt> {
    let copied = 0;
    const backups: string[] = [];
    try {
      for (const operation of operations) {
        if (await this.executeOne(operation, backup => backups.push(this.destination.relative(backup)))) {
          copied++;
        }
      }
    } catch (error) {
      if (copied || backups.length) {
        throw new Error(`Export stopped after ${copied} file(s) written. Backups: ${backups.join(', ') || 'none'}. Preview again before retrying. ${String(error)}`);
      }
      throw error;
    }
    return backups.length ? { copied, backups } : { copied };
  }

  private async executeOne(operation: FileOperation, onBackup: (file: string) => void): Promise<boolean> {
    const { relativeDestination, maxBytes, content, previous, output, action } = operation;
    const target = await this.destination.ensureParent(relativeDestination);
    const prior = await this.destination.read(relativeDestination, maxBytes);
    if (hashOrNull(prior) !== previous) {
      throw new Error(`Destination changed; preview again: ${relativeDestination}`);
    }
    const bytes = 'bytes' in content ? content.bytes : await readRegular(content.file, maxBytes);
    if (!bytes || bytes.length > maxBytes || hash(bytes) !== output) {
      throw new Error(`Source changed; preview again: ${relativeDestination}`);
    }
    if (action === 'reuse' && prior !== null && previous === output) {
      return false;
    }
    if (action === 'create' && prior === null) {
      await this.writer.create(target, bytes);
    } else if (action === 'update' && prior !== null) {
      await this.writer.replaceWithBackup(target, bytes, prior, maxBytes, onBackup);
    } else {
      throw new Error('Invalid export job.');
    }
    return true;
  }
}
