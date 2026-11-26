import { HttpClient, ResponseBodyError } from '../../components/http/http-client';

const THUMBNAIL_HOST = 'https://thumbnails.libretro.com';
const GITHUB_API = 'https://api.github.com/repos/libretro-thumbnails';
const GITHUB_RAW = 'https://raw.githubusercontent.com/libretro-thumbnails';
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_GITHUB_TREE_BYTES = 32 * 1024 * 1024;
const BOXART_TIMEOUT_MS = 12000;
const INDEX_TIMEOUT_MS = 15000;

type GithubEntry = { path: string; type: string; sha?: unknown };

/** Owns official URLs, timeouts, fallback and response status handling. */
export class LibretroClient {
  constructor(private readonly http = new HttpClient()) {}

  async requestBoxart(platform: string, filename: string): Promise<Response> {
    const suffix = `Named_Boxarts/${encodeURIComponent(filename)}`;
    const primary = `${THUMBNAIL_HOST}/${encodeURIComponent(platform)}/${suffix}`;
    try {
      const response = await this.requestImage(primary);
      if (response.ok) {
        return response;
      }
      await response.body?.cancel();
    } catch { /* Try the official GitHub mirror. */ }
    const mirror = `${GITHUB_RAW}/${this.githubRepo(platform)}/master/${suffix}`;
    return this.requestImage(mirror);
  }

  async readIndex(platform: string, relative: '.index' | ''): Promise<string> {
    const url = `${THUMBNAIL_HOST}/${encodeURIComponent(platform)}/Named_Boxarts/${relative}`;
    const response = await this.http.get(url, { redirect: 'error', signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    return this.readIndexText(response, MAX_INDEX_BYTES);
  }

  async readGithubFiles(platform: string): Promise<string[]> {
    const root = await this.loadGithubTree(platform, 'master');
    const boxarts = root.find(isBoxartDirectory);
    if (!boxarts || typeof boxarts.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(boxarts.sha)) {
      throw new Error('GitHub Named_Boxarts tree not found.');
    }
    const entries = await this.loadGithubTree(platform, boxarts.sha);
    return entries.filter(isFileEntry).map(entry => entry.path);
  }

  readImage(response: Response, maxBytes: number): Promise<Buffer> {
    return this.http.readBytes(response, maxBytes);
  }

  private requestImage(url: string): Promise<Response> {
    return this.http.get(url, { redirect: 'error', signal: AbortSignal.timeout(BOXART_TIMEOUT_MS) });
  }

  private githubRepo(platform: string): string {
    return encodeURIComponent(platform.replace(/ /g, '_'));
  }

  private async loadGithubTree(platform: string, ref: string): Promise<GithubEntry[]> {
    const url = `${GITHUB_API}/${this.githubRepo(platform)}/git/trees/${encodeURIComponent(ref)}`;
    const response = await this.http.get(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Retrohandler' }
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub tree HTTP ${response.status}.`);
    }
    const data = JSON.parse(await this.readIndexText(response, MAX_GITHUB_TREE_BYTES));
    if (!data || data.truncated || !Array.isArray(data.tree)) {
      throw new Error('GitHub artwork tree is incomplete.');
    }
    return data.tree.filter(isGithubEntry);
  }

  private async readIndexText(response: Response, maxBytes: number): Promise<string> {
    try {
      return await this.http.readText(response, maxBytes);
    } catch (error) {
      if (!(error instanceof ResponseBodyError)) {
        throw error;
      }
      if (error.reason === 'missing') {
        throw new Error('Libretro artwork index is empty.');
      }
      throw new Error(`Libretro artwork index exceeds ${maxBytes / (1024 * 1024)} MiB.`);
    }
  }
}

function isGithubEntry(entry: unknown): entry is GithubEntry {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const value = entry as Record<string, unknown>;
  return typeof value.path === 'string' && typeof value.type === 'string';
}

function isBoxartDirectory(entry: GithubEntry): boolean {
  return entry.path === 'Named_Boxarts' && entry.type === 'tree';
}

function isFileEntry(entry: GithubEntry): boolean {
  return entry.type === 'blob';
}
