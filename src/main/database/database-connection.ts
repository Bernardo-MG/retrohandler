import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { initializeSchema } from './schema';
import { QueryExecutor } from './sql/query-executor';
import { QueryRegistry } from './sql/query-registry';
import type { DatabaseFactory, DatabaseHandle } from './sql/types';

/** Owns one connection; the public API exposes only its lifecycle. */
export class DatabaseConnection {
  private constructor(
    private readonly handle: DatabaseHandle,
    private readonly executor: QueryExecutor
  ) {}

  static open(filePath: string, createDatabase?: DatabaseFactory): DatabaseConnection {
    const registry = new QueryRegistry();
    registry.loadDirectory(path.join(__dirname, 'queries'));

    const handle = this.openHandle(filePath, createDatabase);

    try {
      const executor = new QueryExecutor(handle, registry);
      initializeSchema(handle, executor);

      return new DatabaseConnection(handle, executor);
    } catch (error) {
      handle.close();
      throw error;
    }
  }

  static executorFor(connection: DatabaseConnection): QueryExecutor {
    return connection.executor;
  }

  close(): void {
    this.handle.close();
  }

  private static openHandle(filePath: string, createDatabase?: DatabaseFactory): DatabaseHandle {
    mkdirSync(path.dirname(filePath), { recursive: true });

    const db = createDatabase ? createDatabase(filePath) : this.openNativeDatabase(filePath);

    try {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private static openNativeDatabase(filePath: string): DatabaseHandle {
    const Database = require('better-sqlite3') as new (filename: string) => DatabaseHandle;

    return new Database(filePath);
  }
}
