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
