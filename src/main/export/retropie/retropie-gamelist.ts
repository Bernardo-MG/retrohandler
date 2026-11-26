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
  ) {}

  prepare(games: readonly RetroPieGame[], previous: Buffer | null): Buffer {
    const generated = GameListDocument.fromEntries(games.map(game => this.toEntry(game)));
    if (previous === null) {
      return Buffer.from(generated.toXml(), 'utf8');
    }
    const xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(previous);
    const existing = GameListDocument.parse(xml);
    const merger = new GameListMerger(value => this.layout.resolveGamePath(value, this.system));
    return Buffer.from(merger.merge(existing, generated, this.fallbackNames(games)), 'utf8');
  }

  private toEntry({ entry, filename, image }: RetroPieGame): GameListEntry {
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

  private fallbackNames(games: readonly RetroPieGame[]): ReadonlySet<string> {
    return new Set(games.filter(game =>
      !game.entry.metadata?.title?.trim() && !game.entry.identifiedTitle?.trim()
    ).map(game => game.filename));
  }
}
