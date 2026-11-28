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

/** Match a full, literal entry name, without normalizing an archive path. */
export function selectEntryByName<T extends { name: string }>(
  entries: Iterable<T>,
  name: string,
  validate?: (entry: T) => void
): EntrySelection<T> {
  return selectUniqueEntry(entries, (entry) => entry.name === name, validate);
}

/** Find a file by its basename, including archive directories, without using host path semantics. */
export function selectEntryByBasename<T extends { name: string; directory: boolean }>(
  entries: Iterable<T>,
  basename: string
): EntrySelection<T> {
  return selectUniqueEntry(
    entries,
    (entry) => !entry.directory && (entry.name === basename || entry.name.endsWith(`/${basename}`))
  );
}
