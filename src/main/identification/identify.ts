import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import type { IdentificationProgress, IdentificationResult, IdentificationStatus, LibraryEntry } from '../../shared';
import { hashRom, hashReadable, type RomHashes } from './hashes';
import { SevenZipReader, selectRomMember, type ArchiveReader } from './archives';

// Compressed containers and disc sets require content-aware hashing; never hash
// a ZIP/CHD/container as though it were the underlying uncompressed ROM.
const archives = new Set(['.zip', '.rar', '.7z']);
const directlyHashable = new Set(['.nes', '.fds', '.sfc', '.smc', '.gb', '.gbc', '.gba', '.n64', '.z64', '.v64', '.nds', '.md', '.gen', '.smd', '.sms', '.gg', '.a26', '.a78', '.pce', '.ngp', '.ngc', '.ws', '.wsc', '.rom']);
export interface Fingerprint extends RomHashes { status: IdentificationStatus; title: string | null; datName: string | null; }
export interface IdentificationStore {
  entriesForIdentification(source: string): LibraryEntry[];
  cachedFingerprint(source: string, relativePath: string, size: number, modifiedMs: number): RomHashes | null;
  matchFingerprint(hashes: RomHashes): { status: IdentificationStatus; title: string | null; datName: string | null };
  saveIdentification(source: string, results: IdentificationResult[]): void;
}
export async function identifyCollection(source: string, store: IdentificationStore, options: {
  signal?: AbortSignal; onProgress?: (progress: IdentificationProgress) => void; archiveReader?: ArchiveReader;
} = {}): Promise<{ processed: number; verified: number; probable: number; ambiguous: number; unknown: number; unsupported: number; errors: number }> {
  const files = store.entriesForIdentification(source);
  const results: IdentificationResult[] = [];
  const counters = { processed: 0, verified: 0, probable: 0, ambiguous: 0, unknown: 0, unsupported: 0, errors: 0 };
  for (const entry of files) {
    if (options.signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
    let fingerprint: RomHashes | null = null;
    let status: IdentificationStatus = 'unsupported';
    let title: string | null = null, datName: string | null = null;
    if (directlyHashable.has(entry.extension) || archives.has(entry.extension)) {
      try {
        const filename = path.resolve(source, entry.relativePath);
        const root = path.resolve(source);
        if (!filename.startsWith(root + path.sep)) throw new Error('File is outside collection root.');
        const fileStats = await lstat(filename);
        if (!fileStats.isFile()) throw new Error('Not a regular file.');
        const canonicalRoot = await realpath(root);
        const canonicalFile = await realpath(filename);
        if (!canonicalFile.startsWith(canonicalRoot + path.sep)) throw new Error('File escapes collection.');
        if (archives.has(entry.extension)) {
          const reader = options.archiveReader ?? new SevenZipReader();
          const member = selectRomMember(await reader.list(filename, options.signal));
          if (member) {
            const fingerprintData = await hashReadable(reader.open(filename, member.name, options.signal), member.size, options.signal);
            const after = await lstat(filename);
            if (after.size !== fileStats.size || after.mtimeMs !== fileStats.mtimeMs) throw new Error('Archive changed during identification.');
            fingerprint = { ...fingerprintData, modifiedMs: after.mtimeMs };
          }
        } else {
          fingerprint = store.cachedFingerprint(source, entry.relativePath, fileStats.size, fileStats.mtimeMs) ?? await hashRom(filename, options.signal);
        }
        if (fingerprint) {
          const match = store.matchFingerprint(fingerprint);
          status = match.status; title = match.title; datName = match.datName;
        }
      } catch (error) {
        if (options.signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
        status = 'error';
      }
    }
    results.push({ source, relativePath: entry.relativePath, status, title, datName, fingerprint });
    counters.processed++;
    if (status === 'error') counters.errors++;
    else if (status !== 'pending') counters[status]++;
    if (counters.processed % 10 === 0 || counters.processed === files.length) {
      options.onProgress?.({ ...counters, total: files.length, currentPath: entry.relativePath });
    }
  }
  if (options.signal?.aborted) throw Object.assign(new Error('Identification cancelled.'), { name: 'AbortError' });
  store.saveIdentification(source, results); // Atomic commit only after successful job.
  return counters;
}
