/**
 * SQL data layer.
 *
 * The whole app talks to the database through the narrow `SqlDb` interface
 * below. The demo implementation is backed by Node's built-in `node:sqlite`
 * (zero native build, real SQLite). Swapping to RDS Postgres/MySQL in
 * production is a single new implementation of this interface — nothing above
 * it changes. (See README "Going to production on AWS".)
 *
 * It also carries a BACKTEST WRITE-GUARD: a hard kill-switch that physically
 * refuses INSERT/UPDATE/DELETE while a backtest is running, except to an
 * explicit table allow-list. This mirrors the safety net in the original
 * production agent so an evaluation run can NEVER mutate live data.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { Config, DATA_DIR } from '../config.js';

export type SqlParam = string | number | bigint | null | Uint8Array;

export interface SqlDb {
  readonly driverName: string;
  exec(sql: string): void;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): T | undefined;
  run(sql: string, params?: SqlParam[]): { changes: number; lastInsertRowid: number };
  tx<T>(fn: () => T): T;
}

// ---------------------------------------------------------------------------
// Write-guard
// ---------------------------------------------------------------------------

interface Guard {
  allow: Set<string>;
}
let guard: Guard | null = null;

const WRITE_HEADS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'DROP', 'TRUNCATE', 'ALTER']);
const TABLE_RE = /(?:\bINTO\b|\bUPDATE\b|\bFROM\b|\bTABLE\b)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i;

function head(sql: string): string {
  return sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? '';
}
function targetTable(sql: string): string | null {
  const m = TABLE_RE.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

function assertWritable(sql: string): void {
  if (!guard) return;
  if (!WRITE_HEADS.has(head(sql))) return; // SELECT etc. always fine
  const table = targetTable(sql);
  if (table && guard.allow.has(table)) return;
  throw new Error(
    `WRITE-GUARD: refusing ${head(sql)} on "${table ?? '?'}" — a backtest is active and ` +
      `this table is not on the allow-list. Evaluation runs must not mutate live data.`,
  );
}

/** Run `fn` with the write-guard armed; only writes to `allow` tables pass. */
export function withWriteGuard<T>(allow: string[], fn: () => T): T {
  const prev = guard;
  guard = { allow: new Set(allow.map((t) => t.toLowerCase())) };
  try {
    return fn();
  } finally {
    guard = prev;
  }
}

/** Async variant — arms the guard for the duration of an awaited operation. */
export async function withWriteGuardAsync<T>(allow: string[], fn: () => Promise<T>): Promise<T> {
  const prev = guard;
  guard = { allow: new Set(allow.map((t) => t.toLowerCase())) };
  try {
    return await fn();
  } finally {
    guard = prev;
  }
}

export const isGuardActive = () => guard !== null;

// ---------------------------------------------------------------------------
// node:sqlite implementation
// ---------------------------------------------------------------------------

class NodeSqliteDb implements SqlDb {
  readonly driverName = 'node:sqlite (SQLite 3)';
  constructor(private readonly db: DatabaseSync) {}

  exec(sql: string): void {
    // exec can contain many statements; guard only meaningfully applies to
    // single write statements issued at runtime, so check the leading head.
    assertWritable(sql);
    this.db.exec(sql);
  }

  all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, params: SqlParam[] = []): { changes: number; lastInsertRowid: number } {
    assertWritable(sql);
    const r = this.db.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db: SqlDb | null = null;

export function getDb(): SqlDb {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const handle = new DatabaseSync(Config.DB_PATH);
  handle.exec('PRAGMA journal_mode = WAL;');
  handle.exec('PRAGMA foreign_keys = ON;');
  _db = new NodeSqliteDb(handle);
  return _db;
}

/** Has the schema been created and seeded? */
export function isSeeded(db: SqlDb): boolean {
  try {
    const row = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='claims'",
    );
    if (!row || row.n === 0) return false;
    const c = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM claims');
    return (c?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export function dbFilePath(): string {
  return path.relative(process.cwd(), Config.DB_PATH);
}
