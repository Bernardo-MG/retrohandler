import { xmlEscape } from '../xml/xml-text';
import type { GameListEntry } from './gamelist';

function formatDate(s: string): string | null {
  // EmulationStation requires a full timestamp, but metadata can contain a
  // year or a year-month when the exact release day is unknown.
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2] ?? '01');
  const day = Number(match[3] ?? '01');
  if (year < 1 || month < 1 || month > 12) {
    return null;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) {
    return null;
  }
  return `${match[1]}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T000000`;
}

export function writeGameList(games: readonly GameListEntry[]): string {
  const elements = games.map(game => {
    const props = [
      ['path', game.path],
      ['name', game.name],
      ['desc', game.description],
      ['image', game.image],
      ['releasedate', formatDate(game.released || '')],
      ['developer', game.developer],
      ['publisher', game.publisher],
      ['genre', game.genre]
    ].filter((pair): pair is [string, string] => !!pair[1]?.trim());
    return '  <game>\n' + props.map(([k, v]) => `    <${k}>${xmlEscape(v)}</${k}>`).join('\n') + '\n  </game>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gameList>\n' + elements.join('\n') + '\n</gameList>\n';
}
