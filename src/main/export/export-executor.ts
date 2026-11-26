import path from 'node:path';
import type { ExportReceipt } from '../../shared';
import { readRegular } from '../components/filesystem/file-reader';
import { replaceWithBackup, writeExclusive } from '../components/filesystem/file-writer';
import { ensureSafeDirectory } from '../components/filesystem/paths';
import { hash, hashOrNull, targetPath, type FileOperation } from './export-plan';

/** Execute approved operations in order; preview references never reach this layer. */
export async function executeOperations(
  destination: string,
  operations: readonly FileOperation[]
): Promise<ExportReceipt> {
  let copied = 0;
  const backups: string[] = [];
  try {
    for (const operation of operations) {
      const { relativeDestination, maxBytes, content, previous, output, action } = operation;
      const target = targetPath(destination, relativeDestination);
      await ensureSafeDirectory(path.dirname(target));
      const prior = await readRegular(target, maxBytes);
      if (hashOrNull(prior) !== previous) {
        throw new Error(`Destination changed; preview again: ${relativeDestination}`);
      }
      const bytes = 'bytes' in content ? content.bytes : await readRegular(content.file, maxBytes);
      if (!bytes || bytes.length > maxBytes || hash(bytes) !== output) {
        throw new Error(`Source changed; preview again: ${relativeDestination}`);
      }
      if (action === 'reuse' && prior !== null && previous === output) {
        continue;
      }
      if (action === 'create' && prior === null) {
        await writeExclusive(target, bytes);
      } else if (action === 'update' && prior !== null) {
        await replaceWithBackup(target, bytes, prior, maxBytes, 'retrohandler', backup => {
          backups.push(path.relative(destination, backup).split(path.sep).join('/'));
        });
      } else {
        throw new Error('Invalid export job.');
      }
      copied++;
    }
  } catch (error) {
    if (copied || backups.length) {
      throw new Error(`Export stopped after ${copied} file(s) written. Backups: ${backups.join(', ') || 'none'}. Preview again before retrying. ${String(error)}`);
    }
    throw error;
  }
  return backups.length ? { copied, backups } : { copied };
}
