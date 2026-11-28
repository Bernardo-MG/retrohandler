import { XmlCursor, type XmlTextElement } from '../xml/xml-cursor';
import type { GameListRecord, GameListStructure } from './gamelist-record';

function failInvalidDocument(): never {
  throw new Error('Malformed or unsupported gamelist XML.');
}

export function parseGameList(xml: string): GameListStructure {
  const cursor = new XmlCursor(xml, failInvalidDocument);
  cursor.skipWhitespaceAndComments();
  const root = cursor.readOpeningTag();
  if (root.name !== 'gameList') {
    failInvalidDocument();
  }
  const openingTagEnd = cursor.position;
  const records: GameListRecord[] = [];
  let closingTagStart = cursor.position - 2;
  if (!root.selfClosing) {
    cursor.skipWhitespaceAndComments();
    while (!cursor.atClosingTag) {
      records.push(readRecord(cursor));
      cursor.skipWhitespaceAndComments();
    }
    closingTagStart = cursor.readClosingTag(root.name);
  }
  cursor.skipWhitespaceAndComments();
  if (!cursor.atEnd) {
    failInvalidDocument();
  }
  return {
    records,
    closingTagStart,
    selfClosing: root.selfClosing,
    openingTagEnd
  };
}

function readRecord(cursor: XmlCursor): GameListRecord {
  const tag = cursor.readOpeningTag();
  if (tag.selfClosing || (tag.name !== 'game' && tag.name !== 'folder')) {
    failInvalidDocument();
  }
  const fields: XmlTextElement[] = [];
  cursor.skipWhitespaceAndComments();
  while (!cursor.atClosingTag) {
    fields.push(cursor.readTextElement());
    cursor.skipWhitespaceAndComments();
  }
  const closingTagStart = cursor.readClosingTag(tag.name);
  const paths = fields.filter((f) => f.name === 'path');
  if (paths.length !== 1 || !paths[0].value.trim()) {
    failInvalidDocument();
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
