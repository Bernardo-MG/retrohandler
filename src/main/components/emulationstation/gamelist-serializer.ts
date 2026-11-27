import { serializeXmlTextElement } from '../xml/xml-serializer';
import { formatReleaseDate } from './gamelist-date';
import type { GameListEntry } from './gamelist-entry';

export function serializeGameList(games: readonly GameListEntry[]): string {
  const elements = games.map((game) => serializeGame(game));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gameList>\n' + elements.join('\n') + '\n</gameList>\n';
}

function serializeGame(game: GameListEntry): string {
  const fields: Array<[string, string | null | undefined]> = [
    ['path', game.path],
    ['name', game.name],
    ['desc', game.description],
    ['image', game.image],
    ['releasedate', formatReleaseDate(game.released || '')],
    ['developer', game.developer],
    ['publisher', game.publisher],
    ['genre', game.genre]
  ];
  const elements: string[] = [];
  for (const [name, value] of fields) {
    if (value?.trim()) {
      elements.push('    ' + serializeXmlTextElement(name, value));
    }
  }
  return '  <game>\n' + elements.join('\n') + '\n  </game>';
}
