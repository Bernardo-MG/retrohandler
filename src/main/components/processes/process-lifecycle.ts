import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

export type PipedProcess = ChildProcessByStdio<null, Readable, Readable>;

export function stopProcess(child: PipedProcess): void {
  if (child.exitCode === null && child.signalCode === null && !child.killed) {
    child.kill();
  }
}

export function waitForExit(child: PipedProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('error', reject);
    child.stderr.on('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });
}
