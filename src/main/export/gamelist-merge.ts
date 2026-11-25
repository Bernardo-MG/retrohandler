import path from 'node:path';

// EmulationStation gamelists contain a gameList root, game/folder records and
// flat metadata elements. Preserve original bytes outside changed fields. Do
// not try to repair unknown XML structures, DTDs or malformed documents.
type Span = {
  start: number;
  end: number
};
type Field = Span & {
  name: string;
  value: string
};
type RecordNode = Span & {
  name: string;
  fields: Field[];
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
const validChar = (n: number) => n === 9 || n === 10 || n === 13 ||
  (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);
function checkChars(text: string): void {
  // XML 1.0 does not allow unpaired surrogates, NUL or most controls.
  for (const c of text) if (!validChar(c.codePointAt(0)!)) {
    invalid();
  }
}
function decode(text: string): string {
  if (text.includes('<') || text.includes(']]>')) {
    invalid();
  }
  // Validate each entity before decoding (including bare ampersands).
  return text.replace(
    /&(?:#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);|&/g,
    entity => {
      switch (entity) {
        case '&amp;': return '&'; case '&lt;': return '<'; case '&gt;': return '>';
        case '&quot;': return '"'; case '&apos;': return "'";
      }
      if (!entity.startsWith('&#')) {
        return invalid();
      }
      const hex = entity.startsWith('&#x');
      const n = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      if (!validChar(n)) {
        return invalid();
      }
      return String.fromCodePoint(n);
    }
  );
}
function parse(xml: string): DocumentNode {
  checkChars(xml);
  let pos = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  const take = (re: RegExp): RegExpExecArray | null => {
    re.lastIndex = pos;
    const result = re.exec(xml);
    if (result) {
      pos = re.lastIndex;
    }
    return result;
  };
  const comment = () => {
    if (!xml.startsWith('<!--', pos)) {
      return false;
    }
    const end = xml.indexOf('-->', pos + 4);
    if (end < 0 || xml.slice(pos + 4, end).includes('--') || (end > pos + 4 && xml[end - 1] === '-')) {
      invalid();
    }
    pos = end + 3;
    return true;
  };
  const trivia = () => {
    do {
      take(/[ \t\r\n]*/y);
    } while (comment());
  };
  if (xml.startsWith('<?xml', pos)) {
    if (!take(/<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*\?>/y)) {
      invalid();
    }
  }
  const openTag = () => {
    const start = pos;
    const name = take(/<([A-Za-z_][A-Za-z0-9_.-]*)/y)?.[1] ?? invalid();
    const attrs = new Set<string>();
    for (; ;) {
      const whitespace = take(/[ \t\r\n]*/y)![0];
      if (take(/\/>/y)) {
        return { start, name, empty: true };
      }
      if (take(/>/y)) {
        return { start, name, empty: false };
      }
      if (!whitespace) {
        invalid();
      }
      const a = take(/([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/y) ?? invalid();
      if (attrs.has(a[1]) || a[1] === 'xmlns') {
        invalid();
      }
      attrs.add(a[1]);
      decode(a[2] ?? a[3]);
    }
  };
  const closeTag = (name: string) => {
    const close = pos;
    if (take(/<\/([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*>/y)?.[1] !== name) {
      invalid();
    }
    return close;
  };
  const field = (): Field => {
    const tag = openTag();
    let value = '';
    if (!tag.empty) {
      for (; ;) {
        if (xml.startsWith('</', pos)) {
          closeTag(tag.name);
          break;
        }
        if (comment()) {
          continue;
        }
        if (xml.startsWith('<![CDATA[', pos)) {
          const end = xml.indexOf(']]>', pos + 9);
          if (end < 0) {
            invalid();
          }
          value += xml.slice(pos + 9, end);
          pos = end + 3;
          continue;
        }
        const text = take(/[^<]+/y)?.[0] ?? invalid();
        value += decode(text);
      }
    }
    return {
      name: tag.name,
      start: tag.start,
      end: pos,
      value
    };
  };
  trivia();
  const root = openTag();
  if (root.name !== 'gameList') {
    invalid();
  }
  const rootEnd = pos;
  const records: RecordNode[] = [];
  let close = pos - 2;
  if (!root.empty) {
    for (; ;) {
      trivia();
      if (xml.startsWith('</', pos)) {
        close = closeTag(root.name);
        break;
      }
      const tag = openTag();
      if (tag.empty || (tag.name !== 'game' && tag.name !== 'folder')) {
        invalid();
      }
      const fields: Field[] = [];
      for (; ;) {
        trivia();
        if (xml.startsWith('</', pos)) {
          break;
        }
        fields.push(field());
      }
      const recordClose = closeTag(tag.name);
      if (fields.filter(f => f.name === 'path').length !== 1 || !fields.find(f => f.name === 'path')!.value.trim()) {
        invalid();
      }
      records.push({
        name: tag.name,
        start: tag.start,
        end: pos,
        close: recordClose,
        fields
      });
    }
  }
  trivia();
  if (pos !== xml.length) {
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
  const edits: Array<Span & {
    text: string
  }> = [];
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
  const pieces: string[] = [];
  let pos = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    pieces.push(existing.slice(pos, edit.start), edit.text);
    pos = edit.end;
  }
  pieces.push(existing.slice(pos));
  return pieces.join('');
}
