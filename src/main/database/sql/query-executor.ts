import { PreparedStatements } from './prepared-statements';
import type { QueryRegistry } from './query-registry';
import type { DatabaseHandle, Statement } from './types';

/** A name from a registered catalog, or SQL rendered by an internal query builder. */
export type Query = string | { readonly sql: string };

/** Executes parameterized queries without exposing driver-specific statements to repositories. */
export class QueryExecutor {
  private readonly statements: PreparedStatements;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly registry: QueryRegistry
  ) {
    this.statements = new PreparedStatements(db, registry);
  }

  public sql(name: string): string {
    return this.registry.sql(name);
  }

  public render(name: string, fragments: Readonly<Record<string, string>>): string {
    return this.registry.render(name, fragments);
  }

  public findOne<T>(query: Query, ...params: unknown[]): T | null {
    return (this.prepare(query).get(...params) as T | undefined) ?? null;
  }

  public findRequired<T>(query: Query, ...params: unknown[]): T {
    const result = this.findOne<T>(query, ...params);
    if (result === null) {
      throw new Error('Expected a database record.');
    }
    return result;
  }

  public findAll<T>(query: Query, ...params: unknown[]): T[] {
    return this.prepare(query).all(...params) as T[];
  }

  public execute(query: Query, ...params: unknown[]): number {
    return this.prepare(query).run(...params).changes;
  }

  /** Only trusted, registered, parameter-free SQL scripts are allowed here. */
  public executeBatch(name: string): void {
    const text = this.registry.sql(name);
    if (/\{\{|\}\}/.test(text)) {
      throw new Error(`SQL script requires explicit fragments: ${name}`);
    }
    this.db.exec(text);
  }

  public transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  private prepare(query: Query): Statement {
    // Dynamic statements are intentionally not cached: arbitrary filter combinations
    // must not grow a connection-wide cache of prepared statements.
    return typeof query === 'string' ? this.statements.get(query) : this.db.prepare(query.sql);
  }
}
