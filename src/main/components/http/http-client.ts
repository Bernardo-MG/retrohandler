import { createWriteStream } from 'node:fs';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class ResponseBodyError extends Error {
  constructor(readonly reason: 'too-large' | 'missing') {
    super(reason === 'too-large' ? 'Response exceeds size limit.' : 'Response body is missing.');
  }
}

type DownloadOptions = {
  maxBytes: number;
  signal?: AbortSignal;
  onProgress?: (processed: number, total: number | null) => void;
};

/** Network transport and bounded reads; providers choose URLs, status and redirect policies. */
export class HttpClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  get(url: string, options: RequestInit = {}): Promise<Response> {
    return this.request(url, options);
  }

  async readBytes(response: Response, maxBytes: number): Promise<Buffer> {
    const body = await this.checkedBody(response, maxBytes);
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        if (size > maxBytes) {
          throw new ResponseBodyError('too-large');
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async readText(response: Response, maxBytes: number): Promise<string> {
    return (await this.readBytes(response, maxBytes)).toString('utf8');
  }

  /** The caller owns the temporary file and cleans it up after any failure. */
  async download(response: Response, destination: string, options: DownloadOptions): Promise<number> {
    const body = await this.checkedBody(response, options.maxBytes);
    const expected = Number(response.headers.get('content-length'));
    const counter = new DownloadCounter(options, expected > 0 ? expected : null);
    await pipeline(
      Readable.fromWeb(body as import('node:stream/web').ReadableStream),
      counter,
      createWriteStream(destination, { flags: 'wx' }),
      { signal: options.signal }
    );
    return counter.processed;
  }

  private async checkedBody(response: Response, maxBytes: number): Promise<ReadableStream<Uint8Array>> {
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ResponseBodyError('too-large');
    }
    if (!response.body) {
      throw new ResponseBodyError('missing');
    }
    return response.body;
  }
}

class DownloadCounter extends Transform {
  processed = 0;

  constructor(private readonly options: DownloadOptions, private readonly total: number | null) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.processed += chunk.length;
    if (this.processed > this.options.maxBytes) {
      callback(new ResponseBodyError('too-large'));
      return;
    }
    try {
      this.options.onProgress?.(this.processed, this.total);
      callback(null, chunk);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
