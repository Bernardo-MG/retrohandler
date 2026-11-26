import { XmlCursor, type XmlTextElement } from '../xml/xml-cursor';
import type { Span } from '../xml/xml-editor';
import { xmlEscape } from '../xml/xml-text';
import type { GameListEntry } from './gamelist-entry';

// Source positions are preserved so changes need not reserialize existing XML.
export type GameListRecord = Span & {
  readonly name: string;
  readonly path: string;
  readonly fields: readonly XmlTextElement[];
  readonly close: number;
};

type DocumentNode = {
  records: GameListRecord[];
  close: number;
  empty: boolean;
  rootEnd: number;
};

/** An EmulationStation document with its original XML and parsed record spans. */
export class GameListDocument {
  private constructor(
    private readonly source: string,
    private parsed?: DocumentNode
  ) {}

  static parse(xml: string): GameListDocument {
    return new GameListDocument(xml, this.parseStructure(xml));
  }

  static fromEntries(entries: readonly GameListEntry[]): GameListDocument {
    return new GameListDocument(this.write(entries));
  }

  toXml(): string { return this.source; }
  slice(span: Span): string { return this.source.slice(span.start, span.end); }
  get records(): readonly GameListRecord[] { return this.structure.records; }
  get close(): number { return this.structure.close; }
  get empty(): boolean { return this.structure.empty; }
  get rootEnd(): number { return this.structure.rootEnd; }

  private get structure(): DocumentNode {
    // New files do not need a parse pass until a consumer asks for their spans.
    return this.parsed ??= GameListDocument.parseStructure(this.source);
  }

  private static invalid(): never {
    throw new Error('Malformed or unsupported gamelist XML.');
  }

  private static parseStructure(xml: string): DocumentNode {
    const cursor = new XmlCursor(xml, GameListDocument.invalid);
    cursor.trivia();
    const root = cursor.openTag();
    if (root.name !== 'gameList') {
      this.invalid();
    }
    const rootEnd = cursor.position;
    const records: GameListRecord[] = [];
    let close = cursor.position - 2;
    if (!root.empty) {
      for (; ;) {
        cursor.trivia();
        if (cursor.atClosingTag) {
          close = cursor.closeTag(root.name);
          break;
        }
        const tag = cursor.openTag();
        if (tag.empty || (tag.name !== 'game' && tag.name !== 'folder')) {
          this.invalid();
        }
        const fields: XmlTextElement[] = [];
        for (; ;) {
          cursor.trivia();
          if (cursor.atClosingTag) {
            break;
          }
          fields.push(cursor.readTextElement());
        }
        const recordClose = cursor.closeTag(tag.name);
        const paths = fields.filter(f => f.name === 'path');
        if (paths.length !== 1 || !paths[0].value.trim()) {
          this.invalid();
        }
        records.push({
          name: tag.name,
          path: paths[0].value,
          start: tag.start,
          end: cursor.position,
          close: recordClose,
          fields
        });
      }
    }
    cursor.trivia();
    if (!cursor.atEnd) {
      this.invalid();
    }
    return {
      records,
      close,
      empty: root.empty,
      rootEnd
    };
  }

  private static formatDate(s: string): string | null {
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

  private static write(games: readonly GameListEntry[]): string {
    const elements = games.map(game => {
      const props = [
        ['path', game.path],
        ['name', game.name],
        ['desc', game.description],
        ['image', game.image],
        ['releasedate', this.formatDate(game.released || '')],
        ['developer', game.developer],
        ['publisher', game.publisher],
        ['genre', game.genre]
      ].filter((pair): pair is [string, string] => !!pair[1]?.trim());
      return '  <game>\n' + props.map(([k, v]) => `    <${k}>${xmlEscape(v)}</${k}>`).join('\n') + '\n  </game>';
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gameList>\n' + elements.join('\n') + '\n</gameList>\n';
  }
}
