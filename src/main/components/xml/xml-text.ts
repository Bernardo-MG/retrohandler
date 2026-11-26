export const invalidXml = (): never => {
  throw new Error('Malformed or unsupported XML.');
};

const invalidXmlChars = /[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
export const xmlEscape = (s: string) => s.replace(new RegExp(invalidXmlChars, 'gu'), '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(
    />/g,
    '&gt;'
  ).replace(
    /"/g,
    '&quot;'
  ).replace(
    /'/g,
    '&apos;'
  );

export const hasInvalidXmlChars = (text: string): boolean => invalidXmlChars.test(text);

const validChar = (n: number) => n === 9 || n === 10 || n === 13 ||
  (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);
export function checkXmlChars(text: string, invalid: () => never = invalidXml): void {
  // XML 1.0 does not allow unpaired surrogates, NUL or most controls.
  for (const c of text) if (!validChar(c.codePointAt(0)!)) {
    invalid();
  }
}
export function decodeXmlText(text: string, invalid: () => never = invalidXml): string {
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
