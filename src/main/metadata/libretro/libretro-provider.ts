import type { ArtworkCache } from '../../components/artwork/artwork-cache';
import { MAX_ARTWORK_BYTES } from '../../components/artwork/artwork-image';
import { ResponseBodyError } from '../../components/http/http-client';
import type { ArtworkProvider, CoverChoice, CoverLookup, CoverSearch } from '../artwork-provider';
import { LibretroCatalogue } from './libretro-catalogue';
import { LibretroClient } from './libretro-client';
import { libretroPlatform } from './libretro-platforms';
import { LibretroTitleMatcher } from './libretro-title-matcher';

const MAX_PREVIEWS = 8;

/** Discover and cache genuine boxart through independent client, catalogue and matcher components. */
export class LibretroProvider implements ArtworkProvider {
  private readonly catalogue: LibretroCatalogue;
  private readonly matcher = new LibretroTitleMatcher();

  constructor(private readonly artwork: ArtworkCache, private readonly client = new LibretroClient()) {
    this.catalogue = new LibretroCatalogue(client);
  }

  async findCover(query: CoverLookup): Promise<string | null> {
    const platform = libretroPlatform(query.system);
    if (!platform) {
      throw new Error(`No Libretro artwork catalogue for system: ${query.system || '(unassigned)'}. Assign a supported system to the ROM first.`);
    }
    for (const title of this.matcher.candidates(query.names)) {
      const response = await this.requestImage(platform, `${title}.png`, 'artwork');
      if (response === null) {
        continue;
      }
      const bytes = await this.readExactImage(response);
      return this.artwork.store(bytes);
    }
    return null;
  }

  async searchCovers(query: CoverSearch): Promise<CoverChoice[]> {
    const platform = libretroPlatform(query.system);
    if (!platform) {
      throw new Error(`No Libretro artwork catalogue for system: ${query.system || '(unassigned)'}.`);
    }
    if (!query.query.trim() || query.query.length > 120) {
      throw new Error('Enter a game title to search for box art.');
    }
    const files = await this.catalogue.getFiles(platform, query.refresh);
    const matches = this.matcher.match(files, { title: query.query, regionHint: query.regionHint });
    const results: CoverChoice[] = [];
    for (const filename of matches) {
      const choice = await this.previewCover(platform, filename);
      if (choice) {
        results.push(choice);
      }
      if (results.length >= MAX_PREVIEWS) {
        break;
      }
    }
    return results;
  }

  private async requestImage(platform: string, filename: string, label: 'artwork' | 'image'): Promise<Response | null> {
    const response = await this.client.requestBoxart(platform, filename);
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Libretro ${label} HTTP ${response.status}.`);
    }
    return response;
  }

  private async readExactImage(response: Response): Promise<Buffer> {
    try {
      return await this.client.readImage(response, MAX_ARTWORK_BYTES);
    } catch (error) {
      if (!(error instanceof ResponseBodyError)) {
        throw error;
      }
      if (error.reason === 'missing') {
        throw new Error('Libretro artwork has no image data.');
      }
      throw new Error('Libretro artwork exceeds size limit.');
    }
  }

  private async previewCover(platform: string, filename: string): Promise<CoverChoice | null> {
    const response = await this.requestImage(platform, filename, 'image');
    if (response === null) {
      return null;
    }
    let bytes: Buffer;
    try {
      bytes = await this.client.readImage(response, MAX_ARTWORK_BYTES);
    } catch (error) {
      if (error instanceof ResponseBodyError) {
        return null;
      }
      throw error;
    }
    try {
      const artworkId = await this.artwork.store(bytes);
      return { title: filename.slice(0, -4), artworkId };
    } catch { /* A listed entry may be broken; continue with valid images. */
      return null;
    }
  }
}
