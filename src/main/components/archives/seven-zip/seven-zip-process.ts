import { spawn } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';
import { throwIfCancelled } from '../../../utils/cancellation';
import { ProcessDiagnostics } from '../../processes/process-diagnostics';
import { stopProcess, waitForExit, type PipedProcess } from '../../processes/process-lifecycle';
import { ProcessOutput } from '../../processes/process-output';

const MAX_LISTING_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTIC_LENGTH = 2048;
const DIAGNOSTIC_SUMMARY_LENGTH = 300;

/** Execute 7-Zip commands and preserve process errors and cancellation. */
export class SevenZipProcess {
  constructor(private readonly executable: string) {}

  public extract(filename: string, entryName: string, signal?: AbortSignal): Readable {
    // Disable wildcard expansion so an archive entry is matched literally.
    const child = this.start(['x', '-so', '-bd', '-y', '-spd', '--', filename, entryName], signal);
    return streamExtraction(child);
  }

  public async list(filename: string, signal?: AbortSignal): Promise<string> {
    const child = this.start(['l', '-slt', '-bd', '--', filename], signal);
    const listing = new ProcessOutput(child, MAX_LISTING_BYTES);
    const diagnostics = diagnosticsFor(child);
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

  private start(args: string[], signal?: AbortSignal): PipedProcess {
    throwIfCancelled(signal);
    return spawn(this.executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal
    });
  }
}

function diagnosticsFor(child: PipedProcess): ProcessDiagnostics {
  return new ProcessDiagnostics(child.stderr, MAX_DIAGNOSTIC_LENGTH, DIAGNOSTIC_SUMMARY_LENGTH);
}

function streamExtraction(child: PipedProcess): Readable {
  const diagnostics = diagnosticsFor(child);
  const output = new PassThrough();
  // An awaiting caller may not have attached its stream consumer yet.
  // Destroyed streams retain their error for subsequent readers.
  output.on('error', () => undefined);
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
