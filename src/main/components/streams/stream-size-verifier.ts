type StreamSizeErrors = {
  invalidSize: string;
  invalidChunk: string;
  oversized: string;
  truncated: string;
};

/** Validate an exact byte count without retaining chunks or owning the stream. */
export class StreamSizeVerifier {
  private processed = 0;

  constructor(
    private readonly expectedSize: number,
    private readonly errors: StreamSizeErrors
  ) {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
      throw new Error(errors.invalidSize);
    }
  }

  public get size(): number {
    return this.processed;
  }

  public accept(chunk: unknown): Uint8Array {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error(this.errors.invalidChunk);
    }
    if (chunk.length > this.expectedSize - this.processed) {
      throw new Error(this.errors.oversized);
    }
    this.processed += chunk.length;
    return chunk;
  }

  public assertComplete(): void {
    if (this.processed !== this.expectedSize) {
      throw new Error(this.errors.truncated);
    }
  }
}
