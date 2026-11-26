import { checkXmlChars, decodeXmlText, invalidXml } from './xml-text';
import type { Span } from './xml-editor';

export type XmlTextElement = Span & {
  name: string;
  value: string;
};

// Restricted XML 1.0 cursor: no DTDs, namespaces or arbitrary processing instructions.
// The caller owns document structure; offsets are JavaScript string indices.
export class XmlCursor {
  private offset: number;

  constructor(
    private readonly xml: string,
    private readonly failInvalidXml: () => never = invalidXml
  ) {
    checkXmlChars(xml, failInvalidXml);
    this.offset = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.readDeclaration();
  }

  get position(): number {
    return this.offset;
  }

  get atClosingTag(): boolean {
    return this.xml.startsWith('</', this.offset);
  }

  get atEnd(): boolean {
    return this.offset === this.xml.length;
  }

  skipWhitespaceAndComments(): void {
    do {
      this.matchAtPosition(/[ \t\r\n]*/y);
    } while (this.skipComment());
  }

  readOpeningTag() {
    const start = this.offset;
    const name = this.matchAtPosition(/<([A-Za-z_][A-Za-z0-9_.-]*)/y)?.[1] ?? this.failInvalidXml();
    const attributes = new Set<string>();
    while (true) {
      const whitespace = this.matchAtPosition(/[ \t\r\n]*/y)![0];
      if (this.matchAtPosition(/\/>/y)) {
        return { start, name, selfClosing: true };
      }
      if (this.matchAtPosition(/>/y)) {
        return { start, name, selfClosing: false };
      }
      if (!whitespace) {
        this.failInvalidXml();
      }
      this.readAttribute(attributes);
    }
  }

  private readAttribute(attributes: Set<string>): void {
    const attributePattern = /([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/y;
    const attribute = this.matchAtPosition(attributePattern) ?? this.failInvalidXml();
    if (attributes.has(attribute[1]) || attribute[1] === 'xmlns') {
      this.failInvalidXml();
    }
    attributes.add(attribute[1]);
    decodeXmlText(attribute[2] ?? attribute[3], this.failInvalidXml);
  }

  readClosingTag(name: string): number {
    const closingTagStart = this.offset;
    if (this.matchAtPosition(/<\/([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*>/y)?.[1] !== name) {
      this.failInvalidXml();
    }
    return closingTagStart;
  }

  readTextElement(): XmlTextElement {
    const tag = this.readOpeningTag();
    const value = tag.selfClosing ? '' : this.readElementContent(tag.name);
    return {
      name: tag.name,
      start: tag.start,
      end: this.offset,
      value
    };
  }

  private readElementContent(name: string): string {
    let value = '';
    while (!this.atClosingTag) {
      value += this.readContentFragment();
    }
    this.readClosingTag(name);
    return value;
  }

  private readContentFragment(): string {
    if (this.skipComment()) {
      return '';
    }
    if (this.xml.startsWith('<![CDATA[', this.offset)) {
      return this.readCdata();
    }
    const text = this.matchAtPosition(/[^<]+/y)?.[0] ?? this.failInvalidXml();
    return decodeXmlText(text, this.failInvalidXml);
  }

  private readCdata(): string {
    const contentStart = this.offset + 9;
    const end = this.xml.indexOf(']]>', contentStart);
    if (end < 0) {
      this.failInvalidXml();
    }
    const value = this.xml.slice(contentStart, end);
    this.offset = end + 3;
    return value;
  }

  private readDeclaration(): void {
    if (!this.xml.startsWith('<?xml', this.offset)) {
      return;
    }
    const declarationPattern = /<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*\?>/y;
    if (!this.matchAtPosition(declarationPattern)) {
      this.failInvalidXml();
    }
  }

  private matchAtPosition(expression: RegExp): RegExpExecArray | null {
    expression.lastIndex = this.offset;
    const result = expression.exec(this.xml);
    if (result) {
      this.offset = expression.lastIndex;
    }
    return result;
  }

  private skipComment(): boolean {
    if (!this.xml.startsWith('<!--', this.offset)) {
      return false;
    }
    const end = this.xml.indexOf('-->', this.offset + 4);
    if (end < 0 || this.xml.slice(this.offset + 4, end).includes('--') || (end > this.offset + 4 && this.xml[end - 1] === '-')) {
      this.failInvalidXml();
    }
    this.offset = end + 3;
    return true;
  }
}
