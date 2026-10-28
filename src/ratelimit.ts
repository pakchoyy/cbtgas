// Rate limiting sederhana lewat tabel rate_counters.
// Window geser per-menit; akses tanpa RLS context (grant langsung ke cbt_app).

import { connect } from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

export async function allow(
  sql: Sql, bucket: string, key: string, limit: number,
): Promise<{ ok: boolean; remaining: number; reset_in_sec: number }> {
  const now = new Date();
  const bucketTime = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  // Insert-or-increment lewat ON CONFLICT.
  const r = await sql`
    insert into rate_counters (bucket, key, window_start, count)
    values (${bucket}, ${key}, ${bucketTime.toISOString()}, 1)
    on conflict (bucket, key, window_start)
    do update set count = rate_counters.count + 1
    returning count`;
  const count = (r[0] as { count: number }).count;
  const ok = count <= limit;
  const resetIn = Math.ceil((bucketTime.getTime() + 60_000 - now.getTime()) / 1000);
  return { ok, remaining: Math.max(0, limit - count), reset_in_sec: resetIn };
}

export function clientIp(headers: Headers): string {
  // Cloudflare pakai CF-Connecting-IP; fallback ke X-Forwarded-For first entry.
  return headers.get("CF-Connecting-IP")
      ?? (headers.get("X-Forwarded-For") ?? "unknown").split(",")[0].trim()
      ?? "unknown";
}

export async function checkOrLimit(
  env: { HYPERDRIVE: Hyperdrive }, headers: Headers, bucket: string, limit: number,
): Promise<Response | null> {
  const ip = clientIp(headers);
  const sql = connect(env.HYPERDRIVE.connectionString);
  const r = await allow(sql, bucket, ip, limit);
  if (r.ok) return null;
  return new Response(JSON.stringify({ error: "rate limit; coba lagi dalam " + r.reset_in_sec + " detik" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(r.reset_in_sec) },
  });
}
