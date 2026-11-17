// Pengganti fungsi SQL SECURITY DEFINER Postgres (db/migrations 0001, 0008, 0011, 0013).
// Neon: memanggil fungsi SQL yang sama persis seperti sebelumnya (RLS tetap menjaga).
// D1 (tx.isD1): query biasa. Tanpa RLS, jadi pembatasan "hanya sekolah aktif / hanya kolom tertentu"
// ditulis eksplisit di sini; fungsi-fungsi ini sengaja lintas-tenant, jangan dipakai untuk data lain.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const parse = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };

export async function resolveSchool(sql: Sql, code: string): Promise<Row[]> {
  if (!sql.isD1) return sql`select id, name, level, logo_key, color from resolve_school(${code})`;
  return sql.unscoped()`select id, name, level, logo_key, color from schools where code = lower(${code}) and active = 1`;
}

export async function findStaffByEmail(sql: Sql, email: string): Promise<Row[]> {
  if (!sql.isD1) return sql`select user_id, school_id, role from find_staff_by_email(${email})`;
  return sql.unscoped()`select u.id as user_id, u.school_id, u.role from users u
    join schools s on s.id = u.school_id and s.active = 1
    where u.email = lower(${email}) and u.active = 1`;
}

// Login siswa tanpa kode sekolah: semua siswa aktif di sekolah aktif dengan username ini.
export async function findStudentsByUsername(sql: Sql, username: string): Promise<Row[]> {
  if (!sql.isD1) return sql`select * from find_students_by_username(${username})`;
  return sql.unscoped()`select st.id, st.school_id, st.name, st.pin_hash, st.locked_until, st.pin_failed_count
    from students st join schools s on s.id = st.school_id and s.active = 1
    where lower(st.username) = lower(trim(${username})) and st.active = 1`;
}

export async function usernameTaken(sql: Sql, username: string): Promise<boolean> {
  return (await findStudentsByUsername(sql, username)).length > 0;
}

export async function publicBank(sql: Sql, slug: string): Promise<Row[]> {
  if (!sql.isD1) return sql`select * from public_bank(${slug})`;
  const rows = await sql.unscoped()`select slug, title, description, payload, download_count from shared_banks where slug = ${slug}`;
  return rows.map((r: Row) => ({ ...r, payload: parse(r.payload) }));
}

export async function incrementBankDownload(sql: Sql, slug: string): Promise<void> {
  if (!sql.isD1) { await sql`select increment_bank_download(${slug})`; return; }
  await sql.unscoped()`update shared_banks set download_count = download_count + 1 where slug = ${slug}`;
}

export async function listPublicBanks(sql: Sql): Promise<Row[]> {
  if (!sql.isD1) return sql`select * from list_public_banks()`;
  const mine = String(sql.ctx?.schoolId ?? "");
  const rows = await sql.unscoped()`select b.slug, b.title, b.description, b.download_count, b.created_at,
      json_array_length(b.payload, '$.questions') as question_count, s.name as school_name,
      b.school_id = ${mine} as mine
    from shared_banks b join schools s on s.id = b.school_id and s.active = 1
    order by b.download_count desc, b.created_at desc limit 200`;
  return rows.map((r: Row) => ({ ...r, mine: !!r.mine }));
}

export type NewSchool = {
  code: string; name: string; level: string; npsn: string | null;
  operator_name: string; operator_phone: string; admin_email: string; google_sub: string | null;
};

// Neon: fungsi register_school (satu transaksi). D1: dua insert; bila admin gagal dibuat, sekolah dihapus lagi.
// Kode kembar dilaporkan dengan bentuk galat Postgres (23505 / schools_code_key) supaya pemanggil tak perlu tahu backend.
export async function registerSchool(sql: Sql, s: NewSchool): Promise<string> {
  if (!sql.isD1) {
    const r = await sql`select register_school(
      ${s.code}, ${s.name}, ${s.level}, ${s.npsn},
      ${s.operator_name}, ${s.operator_phone}, ${s.admin_email}, ${s.google_sub}
    ) as id`;
    return (r[0] as { id: string }).id;
  }
  const raw = sql.unscoped();
  let id: string;
  try {
    const r = await raw`insert into schools (code, name, level, npsn, operator_name, operator_phone, privacy_consent_at)
      values (lower(${s.code}), ${s.name}, ${s.level}, ${s.npsn}, ${s.operator_name}, ${s.operator_phone}, now())
      returning id`;
    id = (r[0] as { id: string }).id;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/UNIQUE constraint failed: schools\.code/i.test(msg)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint "schools_code_key"'),
        { code: "23505", constraint_name: "schools_code_key" });
    }
    throw e;
  }
  try {
    await raw`insert into users (school_id, email, role, google_sub) values (${id}, lower(${s.admin_email}), 'admin', ${s.google_sub})`;
  } catch (e) {
    await raw`delete from schools where id = ${id}`;
    throw e;
  }
  return id;
}

// Jalankan beberapa penulisan sebagai satu kesatuan.
// D1: satu batch() (satu transaksi). Neon: dijalankan berurutan seperti biasa, sudah di dalam transaksi withTenant.
// Tiap langkah menerima pembentuk query q: gunakan q`...` dan q(rows, ...kolom) (di D1 query-nya tertunda sampai batch).
// Langkah tidak boleh bergantung pada hasil langkah sebelumnya: buat id di JS (crypto.randomUUID()), jangan "returning id".
export async function atomic(tx: Sql, steps: Array<(q: Sql) => unknown>): Promise<Row[][]> {
  if (tx.isD1) return tx.batch(steps.map((s) => s(tx.lazy)));
  const out: Row[][] = [];
  for (const s of steps) out.push((await s(tx)) as Row[]);
  return out;
}

// Waktu dari luar (klien, berkas cadangan) -> ISO-8601 UTC "…Z". Postgres mengurai format apa pun menjadi timestamptz;
// D1 menyimpan teks apa adanya dan membandingkannya secara leksikal, jadi formatnya harus seragam saat ditulis.
// null/""/undefined -> null; nilai yang bukan waktu -> galat (bukan disimpan diam-diam).
export function isoTs(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error("Format waktu tidak valid.");
  return d.toISOString();
}
