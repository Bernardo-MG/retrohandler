import path from 'node:path';
import { applyXmlEdits, type XmlEdit } from '../xml/xml-editor';
import { invalidGameList, parseGameList, type RecordNode } from './gamelist-parser';

const gamePath = (record: RecordNode) => record.fields.find(f => f.name === 'path')!.value;

/** Nonempty exported metadata wins for matching ROM paths. Keep the existing
 * path, user statistics, favorites, unexported fields, folders and unrelated
 * games. Unsupported or ambiguous input fails closed instead of losing data. */
export function mergeGameLists(
  existing: string,
  generated: string,
  resolvePath: (value: string) => string | null,
  fallbackNames: ReadonlySet<string> = new Set()
): string {
  const old = parseGameList(existing);
  const fresh = parseGameList(generated);
  const byPath = new Map<string, Array<{
    key: string;
    record: RecordNode
  }>>();
  const unknownBasenames = new Set<string>();
  for (const record of old.records) {
    const key = resolvePath(gamePath(record));
    if (key === null) {
      // A nonstandard absolute/escaping path cannot be safely mapped to the
      // chosen system. Block a possible duplicate rather than guessing.
      unknownBasenames.add(path.posix.basename(gamePath(record).trim().replace(/\\/g, '/')).toLowerCase());
      continue;
    }
    const matches = byPath.get(key.toLowerCase()) ?? [];
    matches.push({ key, record });
    byPath.set(key.toLowerCase(), matches);
  }
  const edits: XmlEdit[] = [];
  const additions: string[] = [];
  for (const record of fresh.records) {
    const key = resolvePath(gamePath(record)) ?? invalidGameList();
    const matches = byPath.get(key.toLowerCase()) ?? [];
    if (unknownBasenames.has(path.posix.basename(key).toLowerCase())) {
      throw new Error(`Unmapped existing ROM path may conflict: ${key}`);
    }
    if (!matches.length) {
      additions.push('  ' + generated.slice(record.start, record.end));
      continue;
    }
    if (matches.length !== 1 || matches[0].key !== key || matches[0].record.name !== 'game') {
      throw new Error(`Ambiguous existing ROM path: ${key}`);
    }
    const previous = matches[0].record;
    const newFields: string[] = [];
    for (const f of record.fields) {
      if (f.name === 'path') {
        continue;
      }
      const same = previous.fields.filter(p => p.name === f.name);
      // A filename-derived fallback should not erase an existing scraped title.
      if (f.name === 'name' && fallbackNames.has(key) && same.some(p => p.value.trim())) {
        continue;
      }
      if (same.length > 1) {
        throw new Error(`Ambiguous metadata field ${f.name} for ${key}`);
      }
      const raw = generated.slice(f.start, f.end);
      if (same.length) {
        if (same[0].value !== f.value) {
          edits.push({ start: same[0].start, end: same[0].end, text: raw });
        }
      } else {
        newFields.push('    ' + raw);
      }
    }
    if (newFields.length) {
      edits.push({ start: previous.close, end: previous.close, text: '\n' + newFields.join('\n') + '\n  ' });
    }
  }
  if (additions.length) {
    const text = '\n' + additions.join('\n') + '\n';
    if (old.empty) {
      edits.push({ start: old.rootEnd - 2, end: old.rootEnd, text: '>' + text + '</gameList>' });
    }
    else {
      edits.push({ start: old.close, end: old.close, text });
    }
  }
  return applyXmlEdits(existing, edits);
}
