import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export type Db = Database.Database;

/** Opens (or creates) the SQLite database, applies connection settings and ensures the schema exists. */
export function openDatabase(filename: string): Db {
  const inMemory = filename === ':memory:';
  if (!inMemory) {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  if (!inMemory) {
    db.pragma('journal_mode = WAL');
  }
  // SQLite leaves foreign key enforcement off unless it is enabled per connection.
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
  return db;
}
