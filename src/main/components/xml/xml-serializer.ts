import { xmlEscape } from './xml-text';

/** Serialize a text element with a trusted, schema-defined tag name. */
export function serializeXmlTextElement(name: string, value: string): string {
  return `<${name}>${xmlEscape(value)}</${name}>`;
}
