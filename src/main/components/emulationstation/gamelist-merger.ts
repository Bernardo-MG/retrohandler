import path from 'node:path';
import { applyXmlEdits, type XmlEdit } from '../xml/xml-editor';
import type { GameListDocument, GameListRecord } from './gamelist-document';

type PathMatch = { normalizedPath: string; record: GameListRecord };

/** Merge nonempty exported metadata without rewriting unrelated source text. */
export class GameListMerger {
  constructor(private readonly resolvePath: (value: string) => string | null) {}

  merge(
    existing: GameListDocument,
    generated: GameListDocument,
    pathsWithFallbackTitles: ReadonlySet<string> = new Set()
  ): string {
    const { recordsByPath, unresolvedBasenames } = this.indexRecords(existing.records);
    const edits: XmlEdit[] = [];
    const additions: string[] = [];
    for (const record of generated.records) {
      const normalizedPath = this.resolvePath(record.path);
      if (normalizedPath === null) {
        throw new Error('Malformed or unsupported gamelist XML.');
      }
      const matches = recordsByPath.get(normalizedPath.toLowerCase()) ?? [];
      if (unresolvedBasenames.has(path.posix.basename(normalizedPath).toLowerCase())) {
        throw new Error(`Unmapped existing ROM path may conflict: ${normalizedPath}`);
      }
      if (!matches.length) {
        additions.push(generated.sourceTextFor(record));
        continue;
      }
      if (matches.length !== 1 || matches[0].normalizedPath !== normalizedPath || matches[0].record.kind !== 'game') {
        throw new Error(`Ambiguous existing ROM path: ${normalizedPath}`);
      }
      const preserveExistingName = pathsWithFallbackTitles.has(normalizedPath);
      const recordEdits = this.createRecordEdits(matches[0], record, generated, preserveExistingName);
      for (const edit of recordEdits) {
        edits.push(edit);
      }
    }
    if (additions.length) {
      edits.push(existing.createAppendEdit(additions));
    }
    return applyXmlEdits(existing.toXml(), edits);
  }

  private indexRecords(records: readonly GameListRecord[]) {
    const recordsByPath = new Map<string, PathMatch[]>();
    const unresolvedBasenames = new Set<string>();
    for (const record of records) {
      const normalizedPath = this.resolvePath(record.path);
      if (normalizedPath === null) {
        // Block a possible duplicate rather than guessing a nonstandard path.
        unresolvedBasenames.add(path.posix.basename(record.path.trim().replace(/\\/g, '/')).toLowerCase());
        continue;
      }
      const matches = recordsByPath.get(normalizedPath.toLowerCase()) ?? [];
      matches.push({ normalizedPath, record });
      recordsByPath.set(normalizedPath.toLowerCase(), matches);
    }
    return { recordsByPath, unresolvedBasenames };
  }

  private createRecordEdits(
    match: PathMatch,
    incomingRecord: GameListRecord,
    generated: GameListDocument,
    preserveExistingName: boolean
  ): XmlEdit[] {
    const { normalizedPath, record: previousRecord } = match;
    const edits: XmlEdit[] = [];
    const newFields: string[] = [];
    for (const field of incomingRecord.fields) {
      if (field.name === 'path') {
        continue;
      }
      const existingFields = previousRecord.fields.filter(old => old.name === field.name);
      // A filename-derived fallback should not erase an existing scraped title.
      if (field.name === 'name' && preserveExistingName && existingFields.some(old => old.value.trim())) {
        continue;
      }
      if (existingFields.length > 1) {
        throw new Error(`Ambiguous metadata field ${field.name} for ${normalizedPath}`);
      }
      const replacementXml = generated.sourceTextFor(field);
      if (existingFields.length) {
        if (existingFields[0].value !== field.value) {
          edits.push({ start: existingFields[0].start, end: existingFields[0].end, text: replacementXml });
        }
      } else {
        newFields.push('    ' + replacementXml);
      }
    }
    if (newFields.length) {
      edits.push({ start: previousRecord.closingTagStart, end: previousRecord.closingTagStart, text: '\n' + newFields.join('\n') + '\n  ' });
    }
    return edits;
  }
}
