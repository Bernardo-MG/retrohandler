export const invalidXml = (): never => {
  throw new Error('Malformed or unsupported XML.');
};

const invalidXmlChars = /[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
export function xmlEscape(text: string): string {
  return text
    .replace(new RegExp(invalidXmlChars, 'gu'), '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const hasInvalidXmlChars = (text: string): boolean => invalidXmlChars.test(text);

function validChar(codePoint: number): boolean {
  return (
    codePoint === 9 ||
    codePoint === 10 ||
    codePoint === 13 ||
    (codePoint >= 32 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}
export function checkXmlChars(text: string, invalid: () => never = invalidXml): void {
  // XML 1.0 does not allow unpaired surrogates, NUL or most controls.
  for (const character of text) {
    if (!validChar(character.codePointAt(0)!)) {
      invalid();
    }
  }
}
export function decodeXmlText(text: string, invalid: () => never = invalidXml): string {
  if (text.includes('<') || text.includes(']]>')) {
    invalid();
  }
  // Validate each entity before decoding (including bare ampersands).
  return text.replace(/&(?:#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);|&/g, (entity) =>
    decodeEntity(entity, invalid)
  );
}

function decodeEntity(entity: string, invalid: () => never): string {
  switch (entity) {
    case '&amp;':
      return '&';
    case '&lt;':
      return '<';
    case '&gt;':
      return '>';
    case '&quot;':
      return '"';
    case '&apos;':
      return "'";
    default:
      return decodeNumericEntity(entity, invalid);
  }
}

function decodeNumericEntity(entity: string, invalid: () => never): string {
  if (!entity.startsWith('&#')) {
    return invalid();
  }
  const hexadecimal = entity.startsWith('&#x');
  const codePoint = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
  if (!validChar(codePoint)) {
    return invalid();
  }
  return String.fromCodePoint(codePoint);
}
