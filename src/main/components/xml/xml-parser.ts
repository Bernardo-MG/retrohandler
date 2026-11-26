import { checkXmlChars, decodeXmlText, invalidXml } from './xml-text';
import type { Span } from './xml-editor';

export type XmlTextElement = Span & {
  name: string;
  value: string;
};

// Restricted XML 1.0 cursor: no DTDs, namespaces or arbitrary processing instructions.
// The caller owns document structure; offsets are JavaScript string indices.
export function createXmlCursor(xml: string, invalid: () => never = invalidXml) {
  checkXmlChars(xml, invalid);
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
      decodeXmlText(a[2] ?? a[3], invalid);
    }
  };
  const closeTag = (name: string) => {
    const close = pos;
    if (take(/<\/([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*>/y)?.[1] !== name) {
      invalid();
    }
    return close;
  };
  const readTextElement = (): XmlTextElement => {
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
        value += decodeXmlText(text, invalid);
      }
    }
    return {
      name: tag.name,
      start: tag.start,
      end: pos,
      value
    };
  };
  return {
    get position() { return pos; },
    get atClosingTag() { return xml.startsWith('</', pos); },
    get atEnd() { return pos === xml.length; },
    trivia,
    openTag,
    closeTag,
    readTextElement
  };
}
