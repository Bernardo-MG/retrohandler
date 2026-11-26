import path from 'node:path';
import { createXmlCursor, type XmlTextElement } from '../components/xml/xml-parser';
import { applyXmlEdits, type Span, type XmlEdit } from '../components/xml/xml-editor';

// EmulationStation gamelists contain a gameList root, game/folder records and
// flat metadata elements. Preserve original bytes outside changed fields. Do
// not try to repair unknown XML structures, DTDs or malformed documents.
type RecordNode = Span & {
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
const invalid = (): never => {
  throw new Error('Malformed or unsupported gamelist XML.');
};
function parse(xml: string): DocumentNode {
  const cursor = createXmlCursor(xml, invalid);
  const { trivia, openTag, closeTag, readTextElement } = cursor;
  trivia();
  const root = openTag();
  if (root.name !== 'gameList') {
    invalid();
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
        invalid();
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
        invalid();
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
    invalid();
  }
  return {
    records,
    close,
    empty: root.empty,
    rootEnd
  };
}

// Match local system-relative paths and standard RetroPie home-directory paths.
// Do not infer that a game in a different subdirectory is the same ROM.
function keyFor(value: string, system: string): string | null {
  let p = value.trim();
  const absolute = /^(?:~|\/home\/[^/]+)\/RetroPie\/roms\/([^/]+)\/(.*)$/.exec(p);
  if (absolute) {
    if (absolute[1] !== system) {
      return null;
    }
    p = absolute[2];
  }
  if (p.startsWith('/') || p.startsWith('~') || p.includes('\\') || /^[A-Za-z]:/.test(p)) {
    return null;
  }
  const key = path.posix.normalize(p);
  return key === '..' || key.startsWith('../') ? null : key;
}
const gamePath = (record: RecordNode) => record.fields.find(f => f.name === 'path')!.value;

/** Nonempty exported metadata wins for matching ROM paths. Keep the existing
 * path, user statistics, favorites, unexported fields, folders and unrelated
 * games. Unsupported or ambiguous input fails closed instead of losing data. */
export function mergeGameLists(
  existing: string,
  generated: string,
  system: string,
  fallbackNames: ReadonlySet<string> = new Set()
): string {
  const old = parse(existing);
  const fresh = parse(generated);
  const byPath = new Map<string, Array<{
    key: string;
    record: RecordNode
  }>>();
  const unknownBasenames = new Set<string>();
  for (const record of old.records) {
    const key = keyFor(gamePath(record), system);
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
    const key = keyFor(gamePath(record), system) ?? invalid();
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
