// A small stand-in for Cloudflare D1 over node:sqlite, enough for the Worker and the refresher to run in tests.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const plain = (row) => (row ? { ...row } : row);

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    for (const p of params) if (p === undefined) throw new TypeError(`D1_TYPE_ERROR: undefined bound in: ${this.sql.slice(0, 80)}`);
    return new Statement(this.db, this.sql, params);
  }

  #prepared() {
    this.db.calls.push(this.sql);
    return this.db.sqlite.prepare(this.sql);
  }

  async all() { return this.execute(); }

  async first(column) {
    const row = plain(this.#prepared().get(...this.params)) ?? null;
    return column ? row?.[column] ?? null : row;
  }

  async run() { return this.execute(); }

  execute() {
    const s = this.#prepared();
    if (s.columns().length) {
      const results = s.all(...this.params).map(plain);
      return { success: true, results, meta: { changes: /\bRETURNING\b/i.test(this.sql) ? results.length : 0 } };
    }
    const info = s.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export function createD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    sqlite,
    calls: [],
    prepare: (sql) => new Statement(db, sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = statements.map((s) => s.execute());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) { sqlite.exec(sql); },
    load(file) { sqlite.exec(fs.readFileSync(path.join(ROOT, file), 'utf8')); return db; },
  };
  return db;
}

// The Worker imports src/generated/static.js, which `npm run build` writes (it is not committed).
export function ensureStaticBundle() {
  if (!fs.existsSync(path.join(ROOT, 'src/generated/static.js'))) {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-static.mjs')], { stdio: 'ignore' });
  }
}

// caches.default as the Workers runtime provides it, kept in memory.
export function installCache() {
  const store = new Map();
  globalThis.caches = {
    default: {
      store,
      async match(req) { const r = store.get(typeof req === 'string' ? req : req.url); return r ? r.clone() : undefined; },
      async put(req, res) { store.set(typeof req === 'string' ? req : req.url, res.clone()); },
    },
  };
  return store;
}

// For requests sent at the same moment: together(n) returns a wait that holds each caller until n have called
// it. metered(d1, wait) wraps a D1 binding (this stand-in, or workerd's) so that first() answers only after
// wait(), and adds up the rows each statement read and wrote (meta.rows_read and rows_written, which workerd's D1
// reports and this stand-in does not). The corrections form reads with first() only in its pre-check, so with
// one metered binding per request and a shared wait, every request gets past the pre-check before any is stored.
export function together(n) {
  let arrived = 0;
  let release;
  const all = new Promise((resolve) => { release = resolve; });
  return () => { if (++arrived >= n) release(); return all; };
}

export function metered(d1, wait = async () => {}) {
  const meter = { rows: 0, written: 0 };
  const add = (r) => { meter.rows += r.meta?.rows_read ?? 0; meter.written += r.meta?.rows_written ?? 0; return r; };
  const wrap = (stmt) => ({
    stmt,
    bind: (...params) => wrap(stmt.bind(...params)),
    async first(column) {
      const row = add(await stmt.all()).results[0] ?? null;
      await wait();
      return column ? row?.[column] ?? null : row;
    },
    all: async () => add(await stmt.all()),
    run: async () => add(await stmt.run()),
  });
  return {
    meter,
    prepare: (sql) => wrap(d1.prepare(sql)),
    batch: async (list) => (await d1.batch(list.map((s) => s.stmt))).map(add),
    exec: (sql) => d1.exec(sql),
  };
}

export function makeCtx() {
  const pending = [];
  return { pending, waitUntil: (p) => pending.push(p), settle: () => Promise.all(pending) };
}
