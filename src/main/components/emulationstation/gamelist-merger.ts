import path from 'node:path';
import { applyXmlEdits, type XmlEdit } from '../xml/xml-editor';
import type { GameListDocument, GameListRecord } from './gamelist-document';
import type { XmlTextElement } from '../xml/xml-cursor';

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
      const normalizedPath = this.requireNormalizedPath(record.path);
      const match = this.findMatchingRecord(normalizedPath, recordsByPath, unresolvedBasenames);
      if (!match) {
        additions.push(generated.sourceTextFor(record));
        continue;
      }
      const preserveExistingName = pathsWithFallbackTitles.has(normalizedPath);
      const recordEdits = this.createRecordEdits(match, record, generated, preserveExistingName);
      for (const edit of recordEdits) {
        edits.push(edit);
      }
    }
    if (additions.length) {
      edits.push(existing.createAppendEdit(additions));
    }
    return applyXmlEdits(existing.toXml(), edits);
  }

  private requireNormalizedPath(value: string): string {
    const normalizedPath = this.resolvePath(value);
    if (normalizedPath === null) {
      throw new Error('Malformed or unsupported gamelist XML.');
    }
    return normalizedPath;
  }

  private findMatchingRecord(
    normalizedPath: string,
    recordsByPath: ReadonlyMap<string, PathMatch[]>,
    unresolvedBasenames: ReadonlySet<string>
  ): PathMatch | undefined {
    if (unresolvedBasenames.has(path.posix.basename(normalizedPath).toLowerCase())) {
      throw new Error(`Unmapped existing ROM path may conflict: ${normalizedPath}`);
    }
    const matches = recordsByPath.get(normalizedPath.toLowerCase()) ?? [];
    if (!matches.length) {
      return undefined;
    }
    const [match] = matches;
    if (matches.length !== 1 || match.normalizedPath !== normalizedPath || match.record.kind !== 'game') {
      throw new Error(`Ambiguous existing ROM path: ${normalizedPath}`);
    }
    return match;
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
      if (this.shouldPreserveExistingTitle(field, existingFields, preserveExistingName)) {
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
      edits.push({ start: previousRecord.closingTagStart, end: previousRecord.closingTagStart, text: '\n' + newFields.join('\n') + '\n  ' });
    }
    return edits;
  }

  private shouldPreserveExistingTitle(
    field: XmlTextElement,
    existingFields: readonly XmlTextElement[],
    preserveExistingName: boolean
  ): boolean {
    return field.name === 'name' && preserveExistingName && existingFields.some(old => old.value.trim());
  }
}
