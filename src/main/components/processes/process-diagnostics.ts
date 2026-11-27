import type { Readable } from 'node:stream';

export class ProcessDiagnostics {
  private text = '';

  constructor(
    stream: Readable,
    private readonly maxLength: number,
    private readonly summaryLength: number
  ) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => this.append(chunk));
  }

  public get summary(): string {
    return this.text.slice(0, this.summaryLength);
  }

  private append(chunk: string): void {
    this.text = (this.text + chunk).slice(-this.maxLength);
  }
}
