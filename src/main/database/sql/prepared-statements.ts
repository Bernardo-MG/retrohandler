import type { DatabaseHandle, Statement } from './types';
import type { QueryRegistry } from './query-registry';

/** Reuse static statements for the lifetime of one SQLite connection. */
export class PreparedStatements {
  private readonly statements = new Map<string, Statement>();

  constructor(
    private readonly db: DatabaseHandle,
    private readonly registry: QueryRegistry
  ) {}

  get(name: string): Statement {
    let statement = this.statements.get(name);
    if (!statement) {
      const text = this.registry.sql(name);
      if (/\{\{|\}\}/.test(text)) {
        throw new Error(`SQL template requires explicit fragments: ${name}`);
      }
      statement = this.db.prepare(text);
      this.statements.set(name, statement);
    }
    return statement;
  }
}
