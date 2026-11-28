import { stopProcess, type PipedProcess } from './process-lifecycle';

/** Keep the actual byte count bounded, even when output uses multibyte text. */
export class ProcessOutput {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private overflow = false;

  constructor(
    private readonly child: PipedProcess,
    private readonly maxBytes: number
  ) {
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
    if (this.size > this.maxBytes) {
      this.overflow = true;
      stopProcess(this.child);
      return;
    }
    this.chunks.push(chunk);
  }
}
