import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** SQL definitions belong to their registering module, not to the registry. */
export class QueryRegistry {
  private readonly queries = new Map<string, string>();

  public load(namespace: string, file: string): void {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace)) {
      throw new Error(`Invalid SQL namespace: ${namespace}`);
    }
    const contents = readFileSync(file, 'utf8');
    const sections = [...contents.matchAll(/^-- name: ([A-Za-z][A-Za-z0-9]*)\r?$/gm)];
    const pending = new Map<string, string>();
    if (!sections.length || contents.slice(0, sections[0].index).trim()) {
      throw new Error(`Invalid SQL catalog: ${file}`);
    }

    for (let index = 0; index < sections.length; index++) {
      const section = sections[index];
      const start = section.index + section[0].length;
      const end = sections[index + 1]?.index ?? contents.length;
      const name = `${namespace}.${section[1]}`;
      const statement = contents.slice(start, end).trim();
      if (!statement || pending.has(name) || this.queries.has(name)) {
        throw new Error(`Invalid or duplicate SQL statement: ${name}`);
      }
      pending.set(name, statement);
    }

    // Register only after the entire file has been validated.
    for (const [name, statement] of pending) {
      this.queries.set(name, statement);
    }
  }

  /** Discover catalogs by filename in a caller-supplied directory. */
  public loadDirectory(root: string): void {
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (entry.isFile() && entry.name.endsWith('.sql')) {
        this.load(path.basename(entry.name, '.sql'), path.join(root, entry.name));
      }
    }
  }

  public sql(name: string): string {
    const statement = this.queries.get(name);
    if (statement === undefined) {
      throw new Error(`Unknown SQL statement: ${name}`);
    }
    return statement;
  }

  /** Only trusted SQL fragments, never user values, are substituted. */
  public render(name: string, fragments: Readonly<Record<string, string>>): string {
    const used = new Set<string>();
    const statement = this.sql(name).replace(/\{\{([A-Za-z]+)\}\}/g, (_match, key: string) => {
      if (!Object.hasOwn(fragments, key)) {
        throw new Error(`Missing SQL fragment: ${name}.${key}`);
      }
      used.add(key);
      return fragments[key];
    });
    if (Object.keys(fragments).some((key) => !used.has(key)) || /\{\{|\}\}/.test(statement)) {
      throw new Error(`Invalid SQL template fragments: ${name}`);
    }
    return statement;
  }
}
