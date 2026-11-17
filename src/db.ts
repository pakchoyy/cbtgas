import postgres from "postgres";
import { connectD1, withTenantD1, isD1, type D1Sql } from "./d1";

export type Ctx = { schoolId: string; role: string; userId?: string };

export function connect(connectionString: string) {
  return postgres(connectionString, { max: 5, fetch_types: false, prepare: false });
}

// Satu-satunya pintu koneksi database: Neon (bawaan) atau D1 bila DB_BACKEND=d1.
// Tipenya sengaja disamakan dengan postgres.js (adapter D1 meniru API-nya); kode yang berbeda perilaku memakai isD1(tx).
export type DbEnv = { HYPERDRIVE: Hyperdrive; DB?: D1Database; DB_BACKEND?: string };
export function connectDb(env: DbEnv): ReturnType<typeof connect> {
  if (env.DB_BACKEND === "d1") {
    if (!env.DB) throw new Error("DB_BACKEND=d1 tetapi binding D1 'DB' belum ada di wrangler.toml");
    return connectD1(env.DB) as unknown as ReturnType<typeof connect>;
  }
  return connect(env.HYPERDRIVE.connectionString);
}

// Semua query tenant lewat fungsi ini: konteks RLS hanya berlaku dalam satu transaksi.
export function withTenant<T>(
  sql: ReturnType<typeof connect>,
  ctx: Ctx,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  // D1: tak ada RLS/transaksi interaktif; adapter menulis ulang query agar terbatas ke sekolah sesi (src/tenant.ts).
  if (isD1(sql)) return withTenantD1(sql as unknown as D1Sql, ctx, fn as unknown as (tx: D1Sql) => Promise<T>);
  return sql.begin(async (tx) => {
    await tx`select set_config('app.school_id', ${ctx.schoolId}, true),
                    set_config('app.role', ${ctx.role}, true),
                    set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

// Cache edge Cloudflare (tipe DOM tidak mengenal caches.default).
export const edgeCache = () => (caches as unknown as { default: Cache }).default;
