import { MAX_ARCHIVE_ENTRIES, type ArchiveEntry } from '../archive-reader';

/** Parse 7-Zip's technical listing, excluding the archive header. */
export function parse7ZipListing(output: string): ArchiveEntry[] {
  const divider = /^----------\r?$/m.exec(output);
  if (!divider) {
    throw new Error('Invalid 7-Zip archive listing.');
  }
  const content = output.slice(divider.index + divider[0].length);
  const entries: ArchiveEntry[] = [];
  for (const block of content.split(/\r?\n\s*\r?\n/)) {
    const entry = parseEntry(block);
    if (!entry) {
      continue;
    }
    entries.push(entry);
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error('Too many archive entries.');
    }
  }
  return entries;
}

function parseEntry(block: string): ArchiveEntry | null {
  const fields = readFields(block);
  const name = fields.get('Path');
  if (name === undefined) {
    return null;
  }
  return { name, size: readEntrySize(fields.get('Size')), directory: fields.get('Folder') === '+' };
}

function readFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(' = ');
    if (separator !== -1) {
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 3));
    }
  }
  return fields;
}

function readEntrySize(raw: string | undefined): number {
  const size = Number(raw);
  if (!/^[0-9]+$/.test(raw ?? '') || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('Archive has invalid entry size.');
  }
  return size;
}
