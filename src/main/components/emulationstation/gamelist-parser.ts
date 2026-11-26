import { createXmlCursor, type XmlTextElement } from '../xml/xml-parser';
import type { Span } from '../xml/xml-editor';

// EmulationStation gamelists contain a gameList root, game/folder records and
// flat metadata elements. Preserve original bytes outside changed fields. Do
// not try to repair unknown XML structures, DTDs or malformed documents.
export type RecordNode = Span & {
  name: string;
  fields: XmlTextElement[];
  close: number
};
type DocumentNode = {
  records: RecordNode[];
  close: number;
  empty: boolean;
  rootEnd: number
};
export const invalidGameList = (): never => {
  throw new Error('Malformed or unsupported gamelist XML.');
};
export function parseGameList(xml: string): DocumentNode {
  const cursor = createXmlCursor(xml, invalidGameList);
  const { trivia, openTag, closeTag, readTextElement } = cursor;
  trivia();
  const root = openTag();
  if (root.name !== 'gameList') {
    invalidGameList();
  }
  const rootEnd = cursor.position;
  const records: RecordNode[] = [];
  let close = cursor.position - 2;
  if (!root.empty) {
    for (; ;) {
      trivia();
      if (cursor.atClosingTag) {
        close = closeTag(root.name);
        break;
      }
      const tag = openTag();
      if (tag.empty || (tag.name !== 'game' && tag.name !== 'folder')) {
        invalidGameList();
      }
      const fields: XmlTextElement[] = [];
      for (; ;) {
        trivia();
        if (cursor.atClosingTag) {
          break;
        }
        fields.push(readTextElement());
      }
      const recordClose = closeTag(tag.name);
      if (fields.filter(f => f.name === 'path').length !== 1 || !fields.find(f => f.name === 'path')!.value.trim()) {
        invalidGameList();
      }
      records.push({
        name: tag.name,
        start: tag.start,
        end: cursor.position,
        close: recordClose,
        fields
      });
    }
  }
  trivia();
  if (!cursor.atEnd) {
    invalidGameList();
  }
  return {
    records,
    close,
    empty: root.empty,
    rootEnd
  };
}
