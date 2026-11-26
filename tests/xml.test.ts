import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkXmlChars, decodeXmlText, hasInvalidXmlChars, xmlEscape } from '../src/main/components/xml/xml-text';
import { XmlCursor } from '../src/main/components/xml/xml-cursor';
import { applyXmlEdits } from '../src/main/components/xml/xml-editor';

test('XML text escapes reserved characters and removes invalid characters', () => {
  assert.equal(xmlEscape('A & < > " \' \u0000 😀'), 'A &amp; &lt; &gt; &quot; &apos;  😀');
  assert.equal(hasInvalidXmlChars('\ud800'), true);
  assert.equal(hasInvalidXmlChars('😀'), false);
  assert.throws(() => checkXmlChars('\u0000'), /XML/);
});

test('XML entities decode once and reject unsupported entities and invalid characters', () => {
  assert.equal(decodeXmlText('&amp;lt; &#65; &#x1F600;'), '&lt; A 😀');
  for (const value of ['&unknown;', '&', '&#0;', '&#xD800;', '&#x110000;', '<', ']]>']) {
    assert.throws(() => decodeXmlText(value), /XML/);
  }
});

test('XML cursor reads generic tags, text, comments and CDATA with original spans', () => {
  const xml = '\ufeff<?xml version="1.0"?>\n<root><!-- keep --><value id="a&amp;b">A&amp;<![CDATA[<B>]]></value><empty/></root>\n';
  const cursor = new XmlCursor(xml);
  cursor.skipWhitespaceAndComments();
  assert.equal(cursor.readOpeningTag().name, 'root');
  cursor.skipWhitespaceAndComments();
  const field = cursor.readTextElement();
  assert.equal(field.value, 'A&<B>');
  assert.equal(xml.slice(field.start, field.end), '<value id="a&amp;b">A&amp;<![CDATA[<B>]]></value>');
  assert.equal(cursor.readTextElement().value, '');
  assert.equal(cursor.atClosingTag, true);
  cursor.readClosingTag('root');
  cursor.skipWhitespaceAndComments();
  assert.equal(cursor.atEnd, true);
});

test('XML cursor rejects DTDs, duplicate attributes and nested text elements', () => {
  for (const xml of ['<!DOCTYPE root><root/>', '<root a="1" a="2"/>', '<root xmlns="urn:x"/>']) {
    assert.throws(() => new XmlCursor(xml).readOpeningTag(), /XML/);
  }
  for (const xml of ['<value><nested/></value>', '<value>abc</wrong>', '<value><![CDATA[abc</value>']) {
    assert.throws(() => new XmlCursor(xml).readTextElement(), /XML/);
  }
});

test('XML edits preserve all untouched source text and reject overlapping spans', () => {
  const source = '<root>old<!--keep--></root>\r\n';
  const edits = [{ start: 9, end: 9, text: '!' }, { start: 6, end: 9, text: 'new' }];
  assert.equal(applyXmlEdits(source, edits), '<root>new!<!--keep--></root>\r\n');
  assert.equal(edits[0].start, 9);
  assert.throws(() => applyXmlEdits(source, [{ start: 0, end: 5, text: '' }, { start: 3, end: 6, text: '' }]), /overlapping/);
  assert.throws(() => applyXmlEdits(source, [{ start: -1, end: 0, text: '' }]), /Invalid/);
});

test('XML cursors own independent positions and keep caller-provided validation errors', () => {
  const first = new XmlCursor('<one><value>A</value></one>');
  const second = new XmlCursor('<two/>');
  assert.equal(first.readOpeningTag().name, 'one');
  assert.equal(second.position, 0);
  assert.equal(second.readOpeningTag().name, 'two');
  assert.equal(second.atEnd, true);
  assert.equal(first.readTextElement().value, 'A');
  first.readClosingTag('one');
  assert.equal(first.atEnd, true);
  const invalid = (): never => { throw new Error('Custom parse error'); };
  assert.throws(() => new XmlCursor('\u0000', invalid), /Custom parse error/);
  assert.throws(() => new XmlCursor('<root duplicate="1" duplicate="2"/>', invalid).readOpeningTag(), /Custom parse error/);
});

test('XML text elements combine fragments while retaining the complete original span', () => {
  const xml = '<value title="A&amp;B">A<!--ignore--><![CDATA[<B>]]>&#67;<!--end--></value>';
  const cursor = new XmlCursor(xml);
  const field = cursor.readTextElement();
  assert.equal(field.value, 'A<B>C');
  assert.equal(xml.slice(field.start, field.end), xml);
  assert.equal(cursor.atEnd, true);
  for (const malformed of ['<value>unfinished', '<value><!--unfinished', '<value><![CDATA[unfinished']) {
    assert.throws(() => new XmlCursor(malformed).readTextElement(), /XML/);
  }
});
