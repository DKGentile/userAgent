import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, type SqlDb } from './connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Create all tables (idempotent — uses CREATE TABLE IF NOT EXISTS). */
export function migrate(db: SqlDb = getDb()): void {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(sql);
}
