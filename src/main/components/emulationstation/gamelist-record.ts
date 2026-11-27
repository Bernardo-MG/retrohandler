import type { XmlTextElement } from '../xml/xml-cursor';
import type { Span } from '../xml/xml-editor';

// Source positions are preserved so changes need not reserialize existing XML.
export type GameListRecord = Span & {
  readonly kind: 'game' | 'folder';
  readonly path: string;
  readonly fields: readonly XmlTextElement[];
  readonly closingTagStart: number;
};

export type GameListStructure = {
  readonly records: readonly GameListRecord[];
  closingTagStart: number;
  selfClosing: boolean;
  openingTagEnd: number;
};
