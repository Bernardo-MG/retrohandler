import { LibretroClient } from './libretro-client';

const INDEX_TTL_MS = 60 * 60 * 1000;
const MAX_INDEX_ITEMS = 80000;
const INDEX_PATHS = ['.index', ''] as const;

type CachedIndex = { expires: number; files: readonly string[] };

/** Accept filename entries only, never paths or encoded separators. */
function isBoxartName(value: string): boolean {
  return value.toLowerCase().endsWith('.png') && value.length <= 220 && !/[/\\\0-\x1f]/.test(value) && !value.includes('%');
}

/** Collect and deduplicate a bounded set of image filenames. */
class BoxartNames {
  private readonly names = new Set<string>();

  add(value: string): void {
    if (this.names.size < MAX_INDEX_ITEMS && isBoxartName(value)) {
      this.names.add(value);
    }
  }

  addEncoded(value: string): void {
    try {
      this.add(decodeURIComponent(value));
    } catch { /* Ignore malformed catalogue entries. */ }
  }

  toArray(): string[] {
    return [...this.names];
  }
}

export function parseLibretroIndex(data: string): string[] {
  const names = new BoxartNames();
  if (/<(?:html|a)\b/i.test(data)) {
    for (const match of data.matchAll(/href\s*=\s*["']([^"']+\.png)["']/gi)) {
      names.addEncoded(match[1].replace(/&amp;/g, '&'));
    }
  } else {
    for (const line of data.split(/\r?\n/)) {
      names.addEncoded(line.trim());
    }
  }
  return names.toArray();
}

/** Each provider owns its catalogue cache; injected clients never share global state. */
export class LibretroCatalogue {
  private readonly cache = new Map<string, CachedIndex>();

  constructor(private readonly client: LibretroClient, private readonly now = Date.now) {}

  async getFiles(platform: string, refresh = false): Promise<readonly string[]> {
    const cached = this.cache.get(platform);
    if (!refresh && cached && cached.expires > this.now()) {
      return cached.files;
    }
    const files = Object.freeze(await this.loadFiles(platform));
    this.cache.set(platform, { expires: this.now() + INDEX_TTL_MS, files });
    return files;
  }

  private async loadFiles(platform: string): Promise<string[]> {
    const errors: string[] = [];
    for (const relative of INDEX_PATHS) {
      try {
        const files = parseLibretroIndex(await this.client.readIndex(platform, relative));
        if (files.length) {
          return files;
        }
        throw new Error('empty catalogue');
      } catch (error) {
        errors.push(`${relative || 'directory listing'}: ${String(error)}`);
      }
    }
    try {
      const names = new BoxartNames();
      for (const file of await this.client.readGithubFiles(platform)) {
        names.add(file);
      }
      const files = names.toArray();
      if (files.length) {
        return files;
      }
    } catch (error) {
      errors.push(`GitHub: ${String(error)}`);
    }
    throw new Error(`Libretro artwork catalogue unavailable for ${platform} (${errors.join('; ') || 'empty catalogue'}).`);
  }
}
