export type Span = {
  start: number;
  end: number;
};

export type XmlEdit = Span & { text: string };

/** Replace source spans without reserializing unchanged content. */
export function applyXmlEdits(source: string, edits: readonly XmlEdit[]): string {
  const pieces: string[] = [];
  let pos = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < pos ||
      edit.end < edit.start ||
      edit.end > source.length
    ) {
      throw new Error('Invalid or overlapping XML edit.');
    }
    pieces.push(source.slice(pos, edit.start), edit.text);
    pos = edit.end;
  }
  pieces.push(source.slice(pos));
  return pieces.join('');
}
