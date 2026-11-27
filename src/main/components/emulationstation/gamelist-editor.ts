import { appendXmlChildren, type XmlEdit } from '../xml/xml-editor';
import type { XmlTextElement } from '../xml/xml-cursor';
import type { GameListDocument } from './gamelist-document';
import type { GameListRecord } from './gamelist-record';
import type { PathMatch } from './gamelist-record-index';

export type FieldMergeContext = {
  normalizedPath: string;
  incoming: Readonly<XmlTextElement>;
  existing: readonly Readonly<XmlTextElement>[];
};

export type GameListMergeOptions = {
  shouldPreserveField?: (context: FieldMergeContext) => boolean;
};

export function createAppendEdit(document: GameListDocument, records: readonly string[]): XmlEdit {
  const text = '\n' + records.map((record) => '  ' + record).join('\n') + '\n';
  return appendXmlChildren({ name: 'gameList', ...document.structure }, text);
}

export function createRecordEdits(
  match: PathMatch,
  incomingRecord: GameListRecord,
  generated: GameListDocument,
  options: GameListMergeOptions
): XmlEdit[] {
  const { normalizedPath, record: previousRecord } = match;
  const edits: XmlEdit[] = [];
  const newFields: string[] = [];
  for (const field of incomingRecord.fields) {
    if (field.name === 'path') {
      continue;
    }
    const existingFields = previousRecord.fields.filter((old) => old.name === field.name);
    if (options.shouldPreserveField?.({ normalizedPath, incoming: field, existing: existingFields })) {
      continue;
    }
    if (existingFields.length > 1) {
      throw new Error(`Ambiguous metadata field ${field.name} for ${normalizedPath}`);
    }
    const replacementXml = generated.sourceTextFor(field);
    const [existingField] = existingFields;
    if (!existingField) {
      newFields.push('    ' + replacementXml);
      continue;
    }
    if (existingField.value !== field.value) {
      edits.push({ start: existingField.start, end: existingField.end, text: replacementXml });
    }
  }
  if (newFields.length) {
    edits.push({
      start: previousRecord.closingTagStart,
      end: previousRecord.closingTagStart,
      text: '\n' + newFields.join('\n') + '\n  '
    });
  }
  return edits;
}
