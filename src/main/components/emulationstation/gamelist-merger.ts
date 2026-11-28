import { applyXmlEdits, type XmlEdit } from '../xml/xml-editor';
import type { GameListDocument } from './gamelist-document';
import { createAppendEdit, createRecordEdits, type GameListMergeOptions } from './gamelist-editor';
import { GameListRecordIndex } from './gamelist-record-index';

/** Merge nonempty exported metadata without rewriting unrelated source text. */
export class GameListMerger {
  constructor(private readonly resolvePath: (value: string) => string | null) {}

  public merge(
    existing: GameListDocument,
    generated: GameListDocument,
    options: GameListMergeOptions = {}
  ): string {
    const index = new GameListRecordIndex(existing.records, this.resolvePath);
    const edits: XmlEdit[] = [];
    const additions: string[] = [];
    for (const record of generated.records) {
      const normalizedPath = this.resolvePath(record.path);
      if (normalizedPath === null) {
        throw new Error('Malformed or unsupported gamelist XML.');
      }
      const match = index.find(normalizedPath);
      if (!match) {
        additions.push(generated.sourceTextFor(record));
        continue;
      }
      const recordEdits = createRecordEdits(match, record, generated, options);
      for (const edit of recordEdits) {
        edits.push(edit);
      }
    }
    if (additions.length) {
      edits.push(createAppendEdit(existing, additions));
    }
    return applyXmlEdits(existing.toXml(), edits);
  }
}
