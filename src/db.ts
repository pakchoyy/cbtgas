import postgres from "postgres";

export type Ctx = { schoolId: string; role: string; userId?: string };

export function connect(connectionString: string) {
  return postgres(connectionString, { max: 5, fetch_types: false, prepare: false });
}

// Semua query tenant lewat fungsi ini: konteks RLS hanya berlaku dalam satu transaksi.
export function withTenant<T>(
  sql: ReturnType<typeof connect>,
  ctx: Ctx,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.school_id', ${ctx.schoolId}, true),
                    set_config('app.role', ${ctx.role}, true),
                    set_config('app.user_id', ${ctx.userId ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

// Cache edge Cloudflare (tipe DOM tidak mengenal caches.default).
export const edgeCache = () => (caches as unknown as { default: Cache }).default;
