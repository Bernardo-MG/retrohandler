import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { QueryName } from './query-names';
import type { DatabaseHandle, Statement } from './types';

const FILES = {
  collections: 'queries/collections.sql',
  roms: 'queries/roms.sql',
  library: 'queries/library.sql',
  identification: 'queries/identification.sql',
  metadata: 'queries/metadata.sql',
  launchbox: 'queries/launchbox.sql',
  schema: 'queries/schema.sql',
  legacy: 'migrations/legacy.sql'
} as const;

type QueryGroup = keyof typeof FILES;
const catalogs = new Map<QueryGroup, ReadonlyMap<string, string>>();

/** Resources are copied beside this module for development, tests and packaging. */
export function readCanonicalSchema(): string {
  return readFileSync(path.join(__dirname, 'schema', 'schema.sql'), 'utf8');
}

function loadCatalog(group: QueryGroup): ReadonlyMap<string, string> {
  const cached = catalogs.get(group);
  if (cached) {
    return cached;
  }

  const file = path.join(__dirname, FILES[group]);
  const contents = readFileSync(file, 'utf8');
  const sections = [...contents.matchAll(/^-- name: ([A-Za-z][A-Za-z0-9]*)\r?$/gm)];
  const statements = new Map<string, string>();
  if (!sections.length || contents.slice(0, sections[0].index).trim()) {
    throw new Error(`Invalid SQL catalog: ${file}`);
  }

  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const start = section.index + section[0].length;
    const end = sections[index + 1]?.index ?? contents.length;
    const name = section[1];
    const statement = contents.slice(start, end).trim();

    if (!statement || statements.has(name)) {
      throw new Error(`Invalid or duplicate SQL statement: ${group}.${name}`);
    }
    statements.set(name, statement);
  }

  catalogs.set(group, statements);
  return statements;
}

export function sql(name: QueryName): string {
  const [group, key] = name.split('.') as [QueryGroup, string];
  if (!Object.hasOwn(FILES, group)) {
    throw new Error(`Unknown SQL group: ${group}`);
  }
  const statement = loadCatalog(group).get(key);
  if (!statement) {
    throw new Error(`Unknown SQL statement: ${name}`);
  }
  return statement;
}

/** Only trusted SQL fragments, never user values, are substituted in templates. */
export function renderQuery(name: QueryName, fragments: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const statement = sql(name).replace(
    /\{\{([A-Za-z]+)\}\}/g,
    (_match, key: string) => {
      if (!Object.hasOwn(fragments, key)) {
        throw new Error(`Missing SQL fragment: ${name}.${key}`);
      }
      used.add(key);
      return fragments[key];
    }
  );
  if (Object.keys(fragments).some((key) => !used.has(key)) || /\{\{|\}\}/.test(statement)) {
    throw new Error(`Invalid SQL template fragments: ${name}`);
  }
  return statement;
}

/** Reuse static statements for the lifetime of one SQLite connection. */
export class PreparedStatements {
  private readonly statements = new Map<QueryName, Statement>();

  constructor(private readonly db: DatabaseHandle) { }

  get(name: QueryName): Statement {
    let statement = this.statements.get(name);
    if (!statement) {
      const text = sql(name);
      if (/\{\{|\}\}/.test(text)) {
        throw new Error(`SQL template requires explicit fragments: ${name}`);
      }
      statement = this.db.prepare(text);
      this.statements.set(name, statement);
    }
    return statement;
  }
}
