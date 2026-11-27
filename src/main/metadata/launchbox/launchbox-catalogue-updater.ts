import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LaunchBoxDownloadProgress } from '../../../shared';
import { ZipArchiveReader } from '../../components/archives/zip-archive-reader';
import { HttpClient, ResponseBodyError } from '../../components/http/http-client';
import { LaunchBoxCatalogueImporter, type ImportOptions } from './launchbox-catalogue-importer';
import { MAX_LAUNCHBOX_XML_BYTES } from './launchbox-xml-reader';

export const LAUNCHBOX_ARCHIVE_URL = 'https://gamesdb.launchbox-app.com/Metadata.zip';
const MAX_ZIP_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const METADATA_FILENAME = 'Metadata.xml';
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type LaunchBoxUpdate = LaunchBoxDownloadProgress;

export type UpdateOptions = {
  signal?: AbortSignal;
  onProgress?: (update: LaunchBoxUpdate) => void;
};

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('LaunchBox update cancelled.');
  }
}

/** One shared updater owns the exclusive catalogue update lifecycle. */
export class LaunchBoxCatalogueUpdater {
  private updating = false;

  constructor(
    private readonly importer: LaunchBoxCatalogueImporter,
    private readonly http = new HttpClient()
  ) {}

  public get isUpdating(): boolean {
    return this.updating;
  }

  public importFile(file: string, options: ImportOptions = {}): Promise<number> {
    return this.runExclusive(() => this.importer.importFile(file, options));
  }

  public download(options: UpdateOptions = {}): Promise<number> {
    return this.runExclusive(() => this.downloadAndImport(options));
  }

  private async runExclusive(update: () => Promise<number>): Promise<number> {
    if (this.updating) {
      throw new Error('A LaunchBox import is already running.');
    }
    this.updating = true;
    try {
      return await update();
    } finally {
      this.updating = false;
    }
  }

  private async downloadAndImport(options: UpdateOptions): Promise<number> {
    assertNotCancelled(options.signal);
    const folder = await mkdtemp(path.join(tmpdir(), 'retrohandler-launchbox-'));
    try {
      const zip = path.join(folder, 'Metadata.zip');
      const xml = path.join(folder, METADATA_FILENAME);
      await this.downloadArchive(zip, options);
      await this.extractArchive(zip, xml, options);
      assertNotCancelled(options.signal);
      return await this.importer.importFile(xml, {
        signal: options.signal,
        onProgress: (count) => options.onProgress?.({ phase: 'import', processed: count, total: null })
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  private async downloadArchive(destination: string, options: UpdateOptions): Promise<void> {
    const response = await this.requestArchive(options.signal);
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`LaunchBox download failed (HTTP ${response.status}).`);
    }
    let bytes: number;
    try {
      bytes = await this.http.download(response, destination, {
        maxBytes: MAX_ZIP_BYTES,
        signal: options.signal,
        onProgress: (processed, total) => options.onProgress?.({ phase: 'download', processed, total })
      });
    } catch (error) {
      if (error instanceof ResponseBodyError && error.reason === 'too-large') {
        throw new Error('LaunchBox ZIP exceeds download limit.');
      }
      throw error;
    }
    assertNotCancelled(options.signal);
    if ((await stat(destination)).size !== bytes) {
      throw new Error('Incomplete LaunchBox ZIP download.');
    }
  }

  private async extractArchive(zip: string, xml: string, options: UpdateOptions): Promise<void> {
    assertNotCancelled(options.signal);
    const archive = new ZipArchiveReader(zip, {
      maxArchiveBytes: MAX_ZIP_BYTES,
      maxEntryBytes: MAX_LAUNCHBOX_XML_BYTES
    });
    await archive.extract(METADATA_FILENAME, xml, {
      signal: options.signal,
      onProgress: (processed, total) => options.onProgress?.({ phase: 'extract', processed, total })
    });
  }

  private async requestArchive(signal?: AbortSignal): Promise<Response> {
    let url = new URL(LAUNCHBOX_ARCHIVE_URL);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      assertNotCancelled(signal);
      this.assertOfficialUrl(url);
      const response = await this.http.get(url.href, { signal, redirect: 'manual' });
      if (response.url) {
        this.assertOfficialUrl(new URL(response.url));
      }
      if (!REDIRECT_STATUS_CODES.has(response.status)) {
        return response;
      }
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new Error('Invalid LaunchBox download redirect.');
      }
      url = new URL(location, url);
    }
    throw new Error('Too many LaunchBox download redirects.');
  }

  /** Never issue a redirected request to a non-LaunchBox host. */
  private assertOfficialUrl(url: URL): void {
    const officialHost = url.hostname === 'launchbox-app.com' || url.hostname.endsWith('.launchbox-app.com');
    if (url.protocol !== 'https:' || !officialHost || url.username || url.password || url.port) {
      throw new Error('Unsafe LaunchBox download redirect.');
    }
  }
}
