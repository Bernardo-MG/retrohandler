/** Minimal driver contract for the SQL component. */
export interface Statement {
  run(...params: unknown[]): {
    changes: number;
  };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface DatabaseHandle {
  pragma(sql: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): Statement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export type DatabaseFactory = (filename: string) => DatabaseHandle;
