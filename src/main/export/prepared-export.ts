import type { ExportFile, ExportOptions, ExportPlan } from '../../shared';
import { sha256 } from '../utils/hashing';
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
  public static fromDraft(
    draft: ExportDraft,
    options: ExportOptions,
    destination: FileDestination
  ): PreparedExport {
    const files = this.synchronizePreviewFiles(draft, destination);
    const plan = { ...draft.plan, files, destination: destination.root };
    return new PreparedExport(
      destination,
      { ...plan, fingerprint: this.calculateFingerprint(plan, options, draft.operations) },
      draft.operations
    );
  }

  public assertApprovedForExecution(approvedFingerprint: string): void {
    if (this.plan.fingerprint !== approvedFingerprint) {
      throw new Error('Export preview changed; preview again.');
    }
    if (this.plan.conflicts.length) {
      throw new Error('Resolve destination conflicts before export.');
    }
    if (!this.plan.files.some((file) => file.kind === 'rom')) {
      throw new Error('No exportable ROMs in preview.');
    }
  }

  private static synchronizePreviewFiles(draft: ExportDraft, destination: FileDestination): ExportFile[] {
    const unmatchedOperations = this.indexOperations(draft.operations);
    const seenDestinations = new Set<string>();
    const files: ExportFile[] = [];
    const hasConflicts = draft.plan.conflicts.length > 0;
    for (const file of draft.plan.files) {
      const destinationKey = destination.resolvePath(file.relativeDestination).toLowerCase();
      if (seenDestinations.has(destinationKey)) {
        throw new Error(`Duplicate export destination: ${file.relativeDestination}`);
      }
      seenDestinations.add(destinationKey);
      const operation = unmatchedOperations.get(file.relativeDestination);
      files.push(this.synchronizeFile(file, operation, hasConflicts));
      if (operation) {
        unmatchedOperations.delete(file.relativeDestination);
      }
    }
    if (unmatchedOperations.size) {
      throw new Error('Export operation missing from preview.');
    }
    return files;
  }

  private static indexOperations(operations: readonly FileOperation[]): Map<string, FileOperation> {
    const indexed = new Map<string, FileOperation>();
    for (const operation of operations) {
      const { relativeDestination } = operation;
      if (indexed.has(relativeDestination)) {
        throw new Error(`Duplicate export operation: ${relativeDestination}`);
      }
      indexed.set(relativeDestination, operation);
    }
    return indexed;
  }

  private static synchronizeFile(
    file: ExportFile,
    operation: FileOperation | undefined,
    hasConflicts: boolean
  ): ExportFile {
    if (file.kind === 'rom') {
      if (operation) {
        throw new Error(`ROM reference cannot be an export operation: ${file.relativeDestination}`);
      }
      return file;
    }
    if (operation) {
      return { ...file, size: operation.size, action: operation.action };
    }
    if (!hasConflicts) {
      throw new Error(`Export operation missing: ${file.relativeDestination}`);
    }
    // Conflicted destinations have a preview entry but no approved operation.
    return file;
  }

  private static operationVersion(operation: FileOperation): [string, string | null, string] {
    return [operation.relativeDestination, operation.previousHash, operation.outputHash];
  }

  /** Retain the existing preview fingerprint format and operation order. */
  private static calculateFingerprint(
    plan: Omit<ExportPlan, 'fingerprint'>,
    options: ExportOptions,
    operations: readonly FileOperation[]
  ): string {
    const { destination, files, warnings, conflicts } = plan;
    const versions = operations.map(this.operationVersion);
    return sha256(
      Buffer.from(
        JSON.stringify({
          destination,
          files,
          warnings,
          conflicts,
          options,
          versions
        }),
        'utf8'
      )
    );
  }
}
