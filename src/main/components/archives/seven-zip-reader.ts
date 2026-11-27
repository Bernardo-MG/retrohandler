import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { throwIfCancelled } from '../async/cancellation';
import { MAX_ARCHIVE_ENTRIES, type ArchiveEntry, type ArchiveReader } from './archive-reader';

const MAX_LISTING_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTIC_LENGTH = 2048;
type ArchiveProcess = ChildProcessByStdio<null, Readable, Readable>;

/** List and stream supported archives using the configured 7-Zip executable. */
export class SevenZipReader implements ArchiveReader {
  constructor(private readonly executable = resolveExecutable()) {}

  public async list(filename: string, signal?: AbortSignal): Promise<ArchiveEntry[]> {
    const output = await this.readListing(filename, signal);
    return parse7ZipListing(output);
  }

  public open(filename: string, entryName: string, signal?: AbortSignal): Readable {
    // Disable wildcard expansion so an archive entry is matched literally.
    const child = this.start(['x', '-so', '-bd', '-y', '-spd', '--', filename, entryName], signal);
    return streamExtraction(child);
  }

  private async readListing(filename: string, signal?: AbortSignal): Promise<string> {
    const child = this.start(['l', '-slt', '-bd', '--', filename], signal);
    const listing = new ListingOutput(child);
    const diagnostics = new ProcessDiagnostics(child.stderr);
    try {
      const code = await waitForExit(child);
      throwIfCancelled(signal);
      if (listing.exceededLimit) {
        throw new Error('Archive listing exceeds limit.');
      }
      if (code !== 0) {
        throw new Error(`7-Zip cannot read archive (${code}): ${diagnostics.summary}`);
      }
      return listing.text;
    } catch (error) {
      stopProcess(child);
      throwIfCancelled(signal);
      throw error;
    }
  }

  private start(args: string[], signal?: AbortSignal): ArchiveProcess {
    throwIfCancelled(signal);
    return spawn(this.executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal
    });
  }
}

function resolveExecutable(): string {
  const configured = process.env.RETROHANDLER_7ZIP;
  if (configured) {
    return configured;
  }
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (!base) {
      continue;
    }
    const candidate = path.join(base, '7-Zip', '7z.exe');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return '7z'; // PATH fallback; 7zz may be configured with RETROHANDLER_7ZIP.
}

function stopProcess(child: ArchiveProcess): void {
  if (child.exitCode === null && child.signalCode === null && !child.killed) {
    child.kill();
  }
}

/** Keep the actual byte count bounded, even when output uses multibyte text. */
class ListingOutput {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private overflow = false;

  constructor(private readonly child: ArchiveProcess) {
    child.stdout.on('data', (chunk: Buffer) => this.append(chunk));
  }

  public get exceededLimit(): boolean {
    return this.overflow;
  }

  public get text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }

  private append(chunk: Buffer): void {
    if (this.overflow) {
      return;
    }
    this.size += chunk.length;
    if (this.size > MAX_LISTING_BYTES) {
      this.overflow = true;
      stopProcess(this.child);
      return;
    }
    this.chunks.push(chunk);
  }
}

class ProcessDiagnostics {
  private text = '';

  constructor(stream: Readable) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => this.append(chunk));
  }

  public get summary(): string {
    return this.text.slice(0, 300);
  }

  private append(chunk: string): void {
    this.text = (this.text + chunk).slice(-MAX_DIAGNOSTIC_LENGTH);
  }
}

function waitForExit(child: ArchiveProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('error', reject);
    child.stderr.on('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });
}

function streamExtraction(child: ArchiveProcess): Readable {
  const diagnostics = new ProcessDiagnostics(child.stderr);
  const output = new PassThrough();
  const fail = (error: Error) => output.destroy(error);
  child.on('error', fail);
  child.stdout.on('error', fail);
  child.stderr.on('error', fail);
  // Wait for process success even if stdout ends early.
  child.stdout.pipe(output, { end: false });
  child.once('close', (code) => completeExtraction(output, code, diagnostics));
  output.once('close', () => stopProcess(child));
  return output;
}

function completeExtraction(output: PassThrough, code: number | null, diagnostics: ProcessDiagnostics): void {
  if (code === 0) {
    output.end();
    return;
  }
  output.destroy(new Error(`7-Zip extraction failed (${code}): ${diagnostics.summary}`));
}

/** Parse 7-Zip's technical listing, excluding the archive header. */
export function parse7ZipListing(output: string): ArchiveEntry[] {
  const divider = /^----------\r?$/m.exec(output);
  if (!divider) {
    throw new Error('Invalid 7-Zip archive listing.');
  }
  const content = output.slice(divider.index + divider[0].length);
  const entries: ArchiveEntry[] = [];
  for (const block of content.split(/\r?\n\s*\r?\n/)) {
    const entry = parseEntry(block);
    if (!entry) {
      continue;
    }
    entries.push(entry);
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error('Too many archive entries.');
    }
  }
  return entries;
}

function parseEntry(block: string): ArchiveEntry | null {
  const fields = readFields(block);
  const name = fields.get('Path');
  if (name === undefined) {
    return null;
  }
  return { name, size: readEntrySize(fields.get('Size')), directory: fields.get('Folder') === '+' };
}

function readFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(' = ');
    if (separator !== -1) {
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 3));
    }
  }
  return fields;
}

function readEntrySize(raw: string | undefined): number {
  const size = Number(raw);
  if (!/^[0-9]+$/.test(raw ?? '') || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('Archive has invalid entry size.');
  }
  return size;
}
