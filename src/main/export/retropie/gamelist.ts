import path from 'node:path';
import type { LibraryEntry } from '../../../shared';
import { mergeGameLists as mergeEmulationStationGameLists } from '../../components/emulationstation/gamelist-merger';
import { writeGameList } from '../../components/emulationstation/gamelist-writer';

export type RetroPieGame = {
  entry: LibraryEntry;
  filename: string;
  image: string | null;
};

export function gameListXml(games: readonly RetroPieGame[]): string {
  return writeGameList(games.map(({ entry, filename, image }) => {
    const metadata = entry.metadata;
    return {
      path: `./${filename}`,
      name: metadata?.title?.trim() || entry.identifiedTitle?.trim() || entry.name,
      description: metadata?.description,
      image: image ? `./images/${image}` : null,
      released: metadata?.released,
      developer: metadata?.developer,
      publisher: metadata?.publisher,
      genre: metadata?.genre
    };
  }));
}

// Match local system-relative paths and standard RetroPie home-directory paths.
// Do not infer that a game in a different subdirectory is the same ROM.
function keyFor(value: string, system: string): string | null {
  let p = value.trim();
  const absolute = /^(?:~|\/home\/[^/]+)\/RetroPie\/roms\/([^/]+)\/(.*)$/.exec(p);
  if (absolute) {
    if (absolute[1] !== system) {
      return null;
    }
    p = absolute[2];
  }
  if (p.startsWith('/') || p.startsWith('~') || p.includes('\\') || /^[A-Za-z]:/.test(p)) {
    return null;
  }
  const key = path.posix.normalize(p);
  return key === '..' || key.startsWith('../') ? null : key;
}
export function mergeGameLists(
  existing: string,
  generated: string,
  system: string,
  fallbackNames: ReadonlySet<string> = new Set()
): string {
  return mergeEmulationStationGameLists(existing, generated, value => keyFor(value, system), fallbackNames);
}

/** Generate metadata and merge it into the exact existing document, if any. */
export function prepareGameList(games: readonly RetroPieGame[], system: string, prior: Buffer | null): Buffer {
  const generated = gameListXml(games);
  if (prior === null) {
    return Buffer.from(generated, 'utf8');
  }
  const fallbackNames = new Set(games.filter(game =>
    !game.entry.metadata?.title?.trim() && !game.entry.identifiedTitle?.trim()
  ).map(game => game.filename));
  const existing = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(prior);
  return Buffer.from(mergeGameLists(existing, generated, system, fallbackNames), 'utf8');
}
