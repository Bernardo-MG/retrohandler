import type { LibraryEntry } from '../../../shared';
import { GameListDocument } from '../../components/emulationstation/gamelist-document';
import type { GameListEntry } from '../../components/emulationstation/gamelist-entry';
import { GameListMerger } from '../../components/emulationstation/gamelist-merger';
import type { RetroPieLayout } from './retropie-layout';

export type RetroPieGame = {
  entry: LibraryEntry;
  filename: string;
  image: string | null;
};

/** Convert library metadata to a RetroPie gamelist and preserve existing metadata. */
export class RetroPieGameList {
  constructor(
    private readonly layout: RetroPieLayout,
    private readonly system: string
  ) { }

  generateOrMerge(games: readonly RetroPieGame[], previousContent: Buffer | null): Buffer {
    const generated = GameListDocument.fromEntries(games.map(game => this.toGameListEntry(game)));
    if (previousContent === null) {
      return Buffer.from(generated.toXml(), 'utf8');
    }
    const xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(previousContent);
    const existing = GameListDocument.parse(xml);
    const merger = new GameListMerger(value => this.layout.normalizeGameReference(value, this.system));
    return Buffer.from(merger.merge(existing, generated, this.pathsWithFallbackTitles(games)), 'utf8');
  }

  private toGameListEntry({ entry, filename, image }: RetroPieGame): GameListEntry {
    const metadata = entry.metadata;
    return {
      path: this.layout.romReference(filename),
      name: metadata?.title?.trim() || entry.identifiedTitle?.trim() || entry.name,
      description: metadata?.description,
      image: image ? this.layout.artworkReference(image) : null,
      released: metadata?.released,
      developer: metadata?.developer,
      publisher: metadata?.publisher,
      genre: metadata?.genre
    };
  }

  private pathsWithFallbackTitles(games: readonly RetroPieGame[]): ReadonlySet<string> {
    const paths = new Set<string>();
    for (const game of games) {
      if (this.usesFallbackTitle(game)) {
        paths.add(game.filename);
      }
    }
    return paths;
  }

  private usesFallbackTitle(game: RetroPieGame): boolean {
    return !game.entry.metadata?.title?.trim() && !game.entry.identifiedTitle?.trim();
  }
}
