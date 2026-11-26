import { XmlCursor, type XmlTextElement } from '../xml/xml-cursor';
import type { Span, XmlEdit } from '../xml/xml-editor';
import { xmlEscape } from '../xml/xml-text';
import type { GameListEntry } from './gamelist-entry';

// Source positions are preserved so changes need not reserialize existing XML.
export type GameListRecord = Span & {
  readonly kind: 'game' | 'folder';
  readonly path: string;
  readonly fields: readonly XmlTextElement[];
  readonly closingTagStart: number;
};

type DocumentNode = {
  records: GameListRecord[];
  closingTagStart: number;
  selfClosing: boolean;
  openingTagEnd: number;
};

/** An EmulationStation document with its original XML and parsed record spans. */
export class GameListDocument {
  private constructor(
    private readonly source: string,
    private parsedStructure?: DocumentNode
  ) {}

  static parse(xml: string): GameListDocument {
    return new GameListDocument(xml, this.parseStructure(xml));
  }

  static fromEntries(entries: readonly GameListEntry[]): GameListDocument {
    return new GameListDocument(this.serializeEntries(entries));
  }

  toXml(): string {
    return this.source;
  }

  sourceTextFor(span: Span): string {
    return this.source.slice(span.start, span.end);
  }

  get records(): readonly GameListRecord[] {
    return this.structure.records;
  }

  /** Create an insertion edit without exposing the document's root offsets. */
  createAppendEdit(records: readonly string[]): XmlEdit {
    const { selfClosing, openingTagEnd, closingTagStart } = this.structure;
    const text = '\n' + records.map(record => '  ' + record).join('\n') + '\n';
    return selfClosing
      ? { start: openingTagEnd - 2, end: openingTagEnd, text: '>' + text + '</gameList>' }
      : { start: closingTagStart, end: closingTagStart, text };
  }

  private get structure(): DocumentNode {
    // New files do not need a parse pass until a consumer asks for their spans.
    return this.parsedStructure ??= GameListDocument.parseStructure(this.source);
  }

  private static failInvalidDocument(): never {
    throw new Error('Malformed or unsupported gamelist XML.');
  }

  private static parseStructure(xml: string): DocumentNode {
    const cursor = new XmlCursor(xml, GameListDocument.failInvalidDocument);
    cursor.skipWhitespaceAndComments();
    const root = cursor.readOpeningTag();
    if (root.name !== 'gameList') {
      this.failInvalidDocument();
    }
    const openingTagEnd = cursor.position;
    const records: GameListRecord[] = [];
    let closingTagStart = cursor.position - 2;
    if (!root.selfClosing) {
      while (true) {
        cursor.skipWhitespaceAndComments();
        if (cursor.atClosingTag) {
          closingTagStart = cursor.readClosingTag(root.name);
          break;
        }
        records.push(this.readRecord(cursor));
      }
    }
    cursor.skipWhitespaceAndComments();
    if (!cursor.atEnd) {
      this.failInvalidDocument();
    }
    return {
      records,
      closingTagStart,
      selfClosing: root.selfClosing,
      openingTagEnd
    };
  }

  private static readRecord(cursor: XmlCursor): GameListRecord {
    const tag = cursor.readOpeningTag();
    if (tag.selfClosing || (tag.name !== 'game' && tag.name !== 'folder')) {
      this.failInvalidDocument();
    }
    const fields: XmlTextElement[] = [];
    while (true) {
      cursor.skipWhitespaceAndComments();
      if (cursor.atClosingTag) {
        break;
      }
      fields.push(cursor.readTextElement());
    }
    const closingTagStart = cursor.readClosingTag(tag.name);
    const paths = fields.filter(f => f.name === 'path');
    if (paths.length !== 1 || !paths[0].value.trim()) {
      this.failInvalidDocument();
    }
    return {
      kind: tag.name,
      path: paths[0].value,
      start: tag.start,
      end: cursor.position,
      closingTagStart,
      fields
    };
  }

  private static formatReleaseDate(releaseDate: string): string | null {
    // EmulationStation requires a full timestamp, but metadata can contain a
    // year or a year-month when the exact release day is unknown.
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(releaseDate.trim());
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

  private static serializeEntries(games: readonly GameListEntry[]): string {
    const elements = games.map(game => {
      const fields = [
        ['path', game.path],
        ['name', game.name],
        ['desc', game.description],
        ['image', game.image],
        ['releasedate', this.formatReleaseDate(game.released || '')],
        ['developer', game.developer],
        ['publisher', game.publisher],
        ['genre', game.genre]
      ].filter((pair): pair is [string, string] => !!pair[1]?.trim());
      return '  <game>\n' + fields.map(([name, value]) => `    <${name}>${xmlEscape(value)}</${name}>`).join('\n') + '\n  </game>';
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gameList>\n' + elements.join('\n') + '\n</gameList>\n';
  }
}
