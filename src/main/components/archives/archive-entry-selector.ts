type EntrySelection<T> = { kind: 'missing' } | { kind: 'ambiguous' } | { kind: 'found'; entry: T };

/** Select exactly one matching entry without buffering the archive directory. */
export function selectUniqueEntry<T extends object>(
  entries: Iterable<T>,
  matches: (entry: T) => boolean,
  validate?: (entry: T) => void
): EntrySelection<T> {
  let selected: T | undefined;
  for (const entry of entries) {
    if (!matches(entry)) {
      continue;
    }
    if (selected !== undefined) {
      return { kind: 'ambiguous' };
    }
    validate?.(entry);
    selected = entry;
  }
  return selected === undefined ? { kind: 'missing' } : { kind: 'found', entry: selected };
}
