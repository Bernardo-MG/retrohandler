import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ExportOptions, ExportPlan } from '../../shared';
import { childOf } from '../components/filesystem/paths';

/** A write operation, independent of the kind of file shown in the preview. */
export type FileOperation = {
  relativeDestination: string;
  content: { file: string } | { bytes: Buffer };
  maxBytes: number;
  size: number;
  action: 'create' | 'update' | 'reuse';
  previous: string | null;
  output: string;
};

/** The strategy describes references and proposed writes; final sizes and actions come from operations. */
export type ExportDraft = {
  plan: Omit<ExportPlan, 'destination' | 'fingerprint'>;
  operations: FileOperation[];
};

export type PreparedExport = {
  plan: ExportPlan;
  operations: FileOperation[];
};

export const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const hashOrNull = (bytes: Buffer | null) => bytes === null ? null : hash(bytes);

export function targetPath(root: string, relative: string): string {
  const target = path.join(root, ...relative.split('/'));
  if (!childOf(root, target)) {
    throw new Error('Invalid export destination path.');
  }
  return target;
}

/** Retain the existing preview fingerprint format and operation order. */
export function fingerprint(
  plan: Omit<ExportPlan, 'fingerprint'>,
  options: ExportOptions,
  operations: readonly FileOperation[]
): string {
  const { destination, files, warnings, conflicts } = plan;
  const versions = operations.map(job => [job.relativeDestination, job.previous, job.output]);
  return createHash('sha256').update(JSON.stringify({
    destination, files, warnings, conflicts, options, versions
  })).digest('hex');
}

/** Keep the preview in sync with the operations that execution will actually use. */
export function finalizeExport(draft: ExportDraft, options: ExportOptions, destination: string): PreparedExport {
  const pending = new Map<string, FileOperation>();
  for (const operation of draft.operations) {
    if (pending.has(operation.relativeDestination)) {
      throw new Error(`Duplicate export operation: ${operation.relativeDestination}`);
    }
    pending.set(operation.relativeDestination, operation);
  }
  const destinations = new Set<string>();
  const files = draft.plan.files.map(file => {
    const key = targetPath(destination, file.relativeDestination).toLowerCase();
    if (destinations.has(key)) {
      throw new Error(`Duplicate export destination: ${file.relativeDestination}`);
    }
    destinations.add(key);
    const operation = pending.get(file.relativeDestination);
    if (file.kind === 'rom') {
      if (operation) {
        throw new Error(`ROM reference cannot be an export operation: ${file.relativeDestination}`);
      }
      return file;
    }
    if (!operation) {
      if (!draft.plan.conflicts.length) {
        throw new Error(`Export operation missing: ${file.relativeDestination}`);
      }
      // Conflicted destinations have a preview entry but no approved operation.
      return file;
    }
    pending.delete(file.relativeDestination);
    return { ...file, size: operation.size, action: operation.action };
  });
  if (pending.size) {
    throw new Error('Export operation missing from preview.');
  }
  const plan = { ...draft.plan, files, destination };
  return { plan: { ...plan, fingerprint: fingerprint(plan, options, draft.operations) }, operations: draft.operations };
}
