// D1 palsu di atas node:sqlite: prepare().bind().all() dan batch() transaksional (semua atau tidak sama sekali), seperti D1.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function fakeD1Db() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(readFileSync(new URL("../db/d1/0001_init.sql", import.meta.url), "utf8"));
  const exec = (sql: string, p: unknown[]) => {
    const st = db.prepare(sql);
    if (st.columns().length) return { results: st.all(...(p as never[])), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(st.run(...(p as never[])).changes) } };
  };
  const stats = { batches: 0, queries: 0 };
  const d1 = {
    prepare: (sql: string) => ({
      sql, params: [] as unknown[],
      bind(...p: unknown[]) { this.params = p; return this; },
      async all() { stats.queries++; return exec(sql, this.params); },
    }),
    async batch(stmts: Array<{ sql: string; params: unknown[] }>) {
      stats.batches++; stats.queries += stmts.length;
      db.exec("BEGIN");
      try { const r = stmts.map((s) => exec(s.sql, s.params)); db.exec("COMMIT"); return r; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  } as unknown as D1Database;
  return { db, d1, stats };
}
export const fakeD1 = () => fakeD1Db().d1;
