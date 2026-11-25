import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { initializeSchema } from './schema';
import type { DatabaseFactory, DatabaseHandle } from './types';

export function openDatabase(filePath: string, createDatabase?: DatabaseFactory): DatabaseHandle {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = createDatabase ? createDatabase(filePath) : openNativeDatabase(filePath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function openNativeDatabase(filePath: string): DatabaseHandle {
  const Database = require('better-sqlite3') as new (filename: string) => DatabaseHandle;
  return new Database(filePath);
}
