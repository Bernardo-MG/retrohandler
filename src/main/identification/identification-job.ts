import type {
  IdentificationProgress,
  IdentificationReceipt,
  IdentificationResult,
  IdentificationStatus
} from '../../shared';
import { throwIfCancelled } from '../components/async/cancellation';

export interface IdentificationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: IdentificationProgress) => void;
}

/** Collect one job's results and publish progress without committing partial data. */
export class IdentificationJob {
  private readonly pendingResults: IdentificationResult[] = [];
  private readonly counters: IdentificationReceipt = {
    processed: 0,
    verified: 0,
    probable: 0,
    ambiguous: 0,
    unknown: 0,
    unsupported: 0,
    errors: 0
  };

  constructor(
    private readonly total: number,
    private readonly options: IdentificationOptions
  ) {}

  public get signal(): AbortSignal | undefined {
    return this.options.signal;
  }

  public get results(): readonly IdentificationResult[] {
    return this.pendingResults;
  }

  public get receipt(): IdentificationReceipt {
    return { ...this.counters };
  }

  public checkCancellation(): void {
    throwIfCancelled(this.signal, 'Identification cancelled.');
  }

  public recordResult(result: IdentificationResult): void {
    this.pendingResults.push(result);
    this.counters.processed++;
    this.countStatus(result.status);
    this.reportProgress(result.relativePath);
  }

  private countStatus(status: IdentificationStatus): void {
    if (status === 'pending') {
      return;
    }
    const key = status === 'error' ? 'errors' : status;
    this.counters[key]++;
  }

  private reportProgress(currentPath: string): void {
    const processed = this.counters.processed;
    if (processed % 10 === 0 || processed === this.total) {
      this.options.onProgress?.({ ...this.receipt, total: this.total, currentPath });
    }
  }
}
