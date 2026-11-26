import { checkXmlChars, decodeXmlText, invalidXml } from './xml-text';
import type { Span } from './xml-editor';

export type XmlTextElement = Span & {
  name: string;
  value: string;
};

// Restricted XML 1.0 cursor: no DTDs, namespaces or arbitrary processing instructions.
// The caller owns document structure; offsets are JavaScript string indices.
export class XmlCursor {
  private pos: number;

  constructor(
    private readonly xml: string,
    private readonly invalid: () => never = invalidXml
  ) {
    checkXmlChars(xml, invalid);
    this.pos = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
    if (this.xml.startsWith('<?xml', this.pos)) {
      if (!this.take(/<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*\?>/y)) {
        this.invalid();
      }
    }
  }

  get position(): number { return this.pos; }
  get atClosingTag(): boolean { return this.xml.startsWith('</', this.pos); }
  get atEnd(): boolean { return this.pos === this.xml.length; }

  trivia(): void {
    do {
      this.take(/[ \t\r\n]*/y);
    } while (this.comment());
  }

  openTag() {
    const start = this.pos;
    const name = this.take(/<([A-Za-z_][A-Za-z0-9_.-]*)/y)?.[1] ?? this.invalid();
    const attrs = new Set<string>();
    for (; ;) {
      const whitespace = this.take(/[ \t\r\n]*/y)![0];
      if (this.take(/\/>/y)) {
        return { start, name, empty: true };
      }
      if (this.take(/>/y)) {
        return { start, name, empty: false };
      }
      if (!whitespace) {
        this.invalid();
      }
      const a = this.take(/([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/y) ?? this.invalid();
      if (attrs.has(a[1]) || a[1] === 'xmlns') {
        this.invalid();
      }
      attrs.add(a[1]);
      decodeXmlText(a[2] ?? a[3], this.invalid);
    }
  }

  closeTag(name: string): number {
    const close = this.pos;
    if (this.take(/<\/([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*>/y)?.[1] !== name) {
      this.invalid();
    }
    return close;
  }

  readTextElement(): XmlTextElement {
    const tag = this.openTag();
    let value = '';
    if (!tag.empty) {
      for (; ;) {
        if (this.xml.startsWith('</', this.pos)) {
          this.closeTag(tag.name);
          break;
        }
        if (this.comment()) {
          continue;
        }
        if (this.xml.startsWith('<![CDATA[', this.pos)) {
          const end = this.xml.indexOf(']]>', this.pos + 9);
          if (end < 0) {
            this.invalid();
          }
          value += this.xml.slice(this.pos + 9, end);
          this.pos = end + 3;
          continue;
        }
        const text = this.take(/[^<]+/y)?.[0] ?? this.invalid();
        value += decodeXmlText(text, this.invalid);
      }
    }
    return {
      name: tag.name,
      start: tag.start,
      end: this.pos,
      value
    };
  }

  private take(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.pos;
    const result = re.exec(this.xml);
    if (result) {
      this.pos = re.lastIndex;
    }
    return result;
  }

  private comment(): boolean {
    if (!this.xml.startsWith('<!--', this.pos)) {
      return false;
    }
    const end = this.xml.indexOf('-->', this.pos + 4);
    if (end < 0 || this.xml.slice(this.pos + 4, end).includes('--') || (end > this.pos + 4 && this.xml[end - 1] === '-')) {
      this.invalid();
    }
    this.pos = end + 3;
    return true;
  }
}
