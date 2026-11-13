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

export function makeCtx() {
  const pending = [];
  return { pending, waitUntil: (p) => pending.push(p), settle: () => Promise.all(pending) };
}
