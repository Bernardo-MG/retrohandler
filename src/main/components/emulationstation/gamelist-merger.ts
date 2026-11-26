import path from 'node:path';
import { applyXmlEdits, type XmlEdit } from '../xml/xml-editor';
import type { GameListDocument, GameListRecord } from './gamelist-document';

type PathMatch = { key: string; record: GameListRecord };

/** Merge nonempty exported metadata without rewriting unrelated source text. */
export class GameListMerger {
  constructor(private readonly resolvePath: (value: string) => string | null) {}

  merge(
    existing: GameListDocument,
    generated: GameListDocument,
    fallbackNames: ReadonlySet<string> = new Set()
  ): string {
    const { byPath, unknownBasenames } = this.indexRecords(existing.records);
    const edits: XmlEdit[] = [];
    const additions: string[] = [];
    for (const record of generated.records) {
      const key = this.resolvePath(record.path);
      if (key === null) {
        throw new Error('Malformed or unsupported gamelist XML.');
      }
      const matches = byPath.get(key.toLowerCase()) ?? [];
      if (unknownBasenames.has(path.posix.basename(key).toLowerCase())) {
        throw new Error(`Unmapped existing ROM path may conflict: ${key}`);
      }
      if (!matches.length) {
        additions.push('  ' + generated.slice(record));
        continue;
      }
      if (matches.length !== 1 || matches[0].key !== key || matches[0].record.name !== 'game') {
        throw new Error(`Ambiguous existing ROM path: ${key}`);
      }
      for (const edit of this.mergeRecord(matches[0].record, record, generated, key, fallbackNames.has(key))) {
        edits.push(edit);
      }
    }
    if (additions.length) {
      edits.push(this.appendRecords(existing, additions));
    }
    return applyXmlEdits(existing.toXml(), edits);
  }

  private indexRecords(records: readonly GameListRecord[]) {
    const byPath = new Map<string, PathMatch[]>();
    const unknownBasenames = new Set<string>();
    for (const record of records) {
      const key = this.resolvePath(record.path);
      if (key === null) {
        // Block a possible duplicate rather than guessing a nonstandard path.
        unknownBasenames.add(path.posix.basename(record.path.trim().replace(/\\/g, '/')).toLowerCase());
        continue;
      }
      const matches = byPath.get(key.toLowerCase()) ?? [];
      matches.push({ key, record });
      byPath.set(key.toLowerCase(), matches);
    }
    return { byPath, unknownBasenames };
  }

  private mergeRecord(
    previous: GameListRecord,
    record: GameListRecord,
    generated: GameListDocument,
    key: string,
    preserveName: boolean
  ): XmlEdit[] {
    const edits: XmlEdit[] = [];
    const newFields: string[] = [];
    for (const field of record.fields) {
      if (field.name === 'path') {
        continue;
      }
      const same = previous.fields.filter(old => old.name === field.name);
      // A filename-derived fallback should not erase an existing scraped title.
      if (field.name === 'name' && preserveName && same.some(old => old.value.trim())) {
        continue;
      }
      if (same.length > 1) {
        throw new Error(`Ambiguous metadata field ${field.name} for ${key}`);
      }
      const raw = generated.slice(field);
      if (same.length) {
        if (same[0].value !== field.value) {
          edits.push({ start: same[0].start, end: same[0].end, text: raw });
        }
      } else {
        newFields.push('    ' + raw);
      }
    }
    if (newFields.length) {
      edits.push({ start: previous.close, end: previous.close, text: '\n' + newFields.join('\n') + '\n  ' });
    }
    return edits;
  }

  private appendRecords(existing: GameListDocument, additions: readonly string[]): XmlEdit {
    const text = '\n' + additions.join('\n') + '\n';
    return existing.empty
      ? { start: existing.rootEnd - 2, end: existing.rootEnd, text: '>' + text + '</gameList>' }
      : { start: existing.close, end: existing.close, text };
  }
}
