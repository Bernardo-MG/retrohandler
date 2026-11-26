import type { ExportOptions, ExportPlan } from '../../shared';
import { hash } from '../components/file-operations/content-hash';
import type { FileDestination } from '../components/file-operations/file-destination';
import type { FileOperation } from '../components/file-operations/file-operation';

/** The strategy describes references and proposed writes; final sizes and actions come from operations. */
export type ExportDraft = {
  plan: Omit<ExportPlan, 'destination' | 'fingerprint'>;
  operations: FileOperation[];
};

/** A finalized preview and its corresponding executable operations. */
export class PreparedExport {
  private constructor(
    readonly destination: FileDestination,
    readonly plan: ExportPlan,
    readonly operations: readonly FileOperation[]
  ) {}

  /** Keep the preview in sync with the operations that execution will actually use. */
  static fromDraft(draft: ExportDraft, options: ExportOptions, destination: FileDestination): PreparedExport {
    const pending = new Map<string, FileOperation>();
    for (const operation of draft.operations) {
      if (pending.has(operation.relativeDestination)) {
        throw new Error(`Duplicate export operation: ${operation.relativeDestination}`);
      }
      pending.set(operation.relativeDestination, operation);
    }
    const destinations = new Set<string>();
    const files = draft.plan.files.map(file => {
      const key = destination.resolve(file.relativeDestination).toLowerCase();
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
    const plan = { ...draft.plan, files, destination: destination.root };
    return new PreparedExport(
      destination,
      { ...plan, fingerprint: this.calculateFingerprint(plan, options, draft.operations) },
      draft.operations
    );
  }

  confirm(approvedFingerprint: string): void {
    if (this.plan.fingerprint !== approvedFingerprint) {
      throw new Error('Export preview changed; preview again.');
    }
    if (this.plan.conflicts.length) {
      throw new Error('Resolve destination conflicts before export.');
    }
    if (!this.plan.files.some(file => file.kind === 'rom')) {
      throw new Error('No exportable ROMs in preview.');
    }
  }

  /** Retain the existing preview fingerprint format and operation order. */
  private static calculateFingerprint(
    plan: Omit<ExportPlan, 'fingerprint'>,
    options: ExportOptions,
    operations: readonly FileOperation[]
  ): string {
    const { destination, files, warnings, conflicts } = plan;
    const versions = operations.map(job => [job.relativeDestination, job.previous, job.output]);
    return hash(Buffer.from(JSON.stringify({
      destination, files, warnings, conflicts, options, versions
    }), 'utf8'));
  }
}
