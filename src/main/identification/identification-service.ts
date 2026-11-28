import type { DatImportReceipt, IdentificationReceipt, IdentificationResult } from '../../shared';
import { throwIfCancelled } from '../utils/cancellation';
import type { FileFingerprint } from '../components/hashing/content-fingerprint';
import type { IdentificationRepository } from '../contracts/persistence';
import { DatReader } from './dat/dat-reader';
import { IdentificationJob, type IdentificationOptions } from './identification-job';
import type { RomFingerprintReader } from './rom/rom-fingerprint-reader';
import type { RomTarget } from './rom/rom-source';

/** Coordinates DAT importing and fingerprint matching independently of Electron. */
export class IdentificationService {
  private readonly activeSources = new Set<string>();

  constructor(
    private readonly repository: IdentificationRepository,
    private readonly fingerprints: RomFingerprintReader,
    private readonly datReader: DatReader
  ) {}

  public async importDat(filename: string): Promise<DatImportReceipt> {
    const catalogue = await this.datReader.read(filename);
    return this.repository.importDat(catalogue);
  }

  public async identifyCollection(
    source: string,
    options: IdentificationOptions = {}
  ): Promise<IdentificationReceipt> {
    throwIfCancelled(options.signal, 'Identification cancelled.');
    if (this.activeSources.has(source)) {
      throw new Error('Identification is already running for this collection.');
    }
    this.activeSources.add(source);
    try {
      return await this.runJob(source, options);
    } finally {
      this.activeSources.delete(source);
    }
  }

  private async runJob(source: string, options: IdentificationOptions): Promise<IdentificationReceipt> {
    const entries = this.repository.entriesForIdentification(source);
    const job = new IdentificationJob(entries.length, options);
    for (const entry of entries) {
      job.checkCancellation();
      const target = { source, relativePath: entry.relativePath, extension: entry.extension };
      const result = await this.identifyEntry(target, job.signal);
      job.recordResult(result);
    }
    // Atomic commit only after a completed, uncancelled job.
    job.checkCancellation();
    this.repository.saveIdentification(source, job.results);
    return job.receipt;
  }

  private async identifyEntry(target: RomTarget, signal?: AbortSignal): Promise<IdentificationResult> {
    const identity = { source: target.source, relativePath: target.relativePath };
    let fingerprint: FileFingerprint | null = null;
    try {
      fingerprint = await this.fingerprints.read(target, signal);
      if (!fingerprint) {
        return { ...identity, fingerprint, status: 'unsupported', title: null, datName: null };
      }
      throwIfCancelled(signal, 'Identification cancelled.');
      return { ...identity, fingerprint, ...this.repository.matchFingerprint(fingerprint) };
    } catch {
      throwIfCancelled(signal, 'Identification cancelled.');
      return { ...identity, fingerprint, status: 'error', title: null, datName: null };
    }
  }
}
