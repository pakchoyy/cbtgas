// REST API staf: kelas & siswa. Semua di-guard sesi staf dan dibungkus withTenant.

import { Hono } from "hono";
import type postgres from "postgres";
import { connect, withTenant, edgeCache } from "./db";
import { requireStaff, AuthBindings } from "./auth";
import { hashPin } from "./hash";
import { sendEmail, inviteEmail, pinNotifyEmail } from "./email";
function esc2(s: string): string { return s.replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]!)); }
import { audit, actorFromSession } from "./audit";
import { distractorRows, itemRows } from "./analytics";
import { BRAND_COLORS, schoolYear } from "./ui";
import { createSession, finalizeSession, writeScore } from "./scoring";

export const api = new Hono<{ Bindings: AuthBindings & { APP_ENV: string; RESEND_API_KEY?: string; EMAIL_FROM?: string } }>();

api.use("/api/*", async (c, next) => {
  // /api/students sudah ada di index.ts (dengan fallback dev). Semua selain itu wajib sesi.
  if (c.req.path === "/api/students" && c.req.method === "GET") return next();
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.json({ error: "unauthorized" }, 401);
  c.set("sess" as never, sess);
  await next();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSess = (c: any) => c.get("sess") as import("./session").Session;

// ===== Pengaturan sekolah =====

api.patch("/api/school", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "Hanya admin." }, 403);
  const b = await c.req.json().catch(() => null) as null | {
    name?: string; level?: string; color?: string; operator_name?: string; operator_phone?: string; npsn?: string | null;
  };
  if (!b) return c.json({ error: "bad body" }, 400);
  if (b.color && !(b.color in BRAND_COLORS)) return c.json({ error: "Warna tidak dikenal." }, 400);
  if (b.level && !["SD", "SMP", "SMA", "CAMPURAN"].includes(b.level)) return c.json({ error: "Jenjang tidak dikenal." }, 400);
  if (b.name !== undefined && !b.name.trim()) return c.json({ error: "Nama sekolah wajib diisi." }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update schools set
        name = coalesce(${b.name?.trim() ?? null}, name),
        level = coalesce(${b.level ?? null}, level),
        color = coalesce(${b.color ?? null}, color),
        operator_name = coalesce(${b.operator_name?.trim() || null}, operator_name),
        operator_phone = coalesce(${b.operator_phone?.trim() || null}, operator_phone),
        npsn = case when ${b.npsn !== undefined} then ${b.npsn?.trim() || null} else npsn end
      where id = ${s.sid} returning name, level, color`;
    await audit(tx, actorFromSession(s), "school.update", "school", s.sid, b as Record<string, unknown>);
    return u[0];
  });
  c.executionCtx.waitUntil(edgeCache().delete(new Request(`https://cache.cbt-yuk/brand/${s.sid}`)));
  return c.json(r);
});

// ===== Classes =====

api.get("/api/classes", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select id, name, grade, year from classes order by year desc, grade nulls last, name`,
  );
  return c.json(rows);
});

api.patch("/api/classes/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const b = await c.req.json().catch(() => null) as null | { name?: string; grade?: number | null; year?: string };
  if (!b || !b.name?.trim() || !b.year?.trim()) return c.json({ error: "Nama kelas dan tahun ajar wajib diisi." }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update classes set name = ${b.name!.trim()}, grade = ${b.grade ?? null}, year = ${b.year!.trim()}
       where id = ${c.req.param("id")} returning id, name, grade, year`);
  if (r.length === 0) return c.json({ error: "kelas tidak ditemukan" }, 404);
  return c.json(r[0]);
});

api.post("/api/classes", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | { name: string; grade?: number | null; year: string };
  if (!body?.name || !body?.year) return c.json({ error: "missing fields" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  try {
    const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
      tx`insert into classes (school_id, name, grade, year)
         values (${s.sid}, ${body.name}, ${body.grade ?? null}, ${body.year})
         returning id, name, grade, year`,
    );
    return c.json(r[0], 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 409);
  }
});

api.delete("/api/classes/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`delete from classes where id = ${id} returning id`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ===== Students =====

api.post("/api/students", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | {
    name: string; username: string; class_id?: string | null;
    gender?: "L" | "P" | null; nisn?: string | null; pin: string;
  };
  if (!body?.name?.trim()) return c.json({ error: "Nama siswa wajib diisi." }, 400);
  if (body.pin && !/^\d{4,8}$/.test(body.pin)) return c.json({ error: "PIN harus 4–8 angka." }, 400);
  try {
    const pin = body.pin || newPin();
    const pin_hash = await hashPin(pin);
    const sql = connect(c.env.HYPERDRIVE.connectionString);
    const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
      const username = body.username?.trim() ? body.username.trim().toLowerCase() : await newUsername(tx, body.name, new Set());
      return tx`insert into students (school_id, class_id, name, username, gender, nisn, pin_hash)
         values (${s.sid}, ${body.class_id ?? null}, ${body.name.trim()}, ${username},
                 ${body.gender ?? null}, ${body.nisn ?? null}, ${pin_hash})
         returning id, name, username`;
    });
    return c.json({ ...(r[0] as object), pin }, 201);
  } catch (e) {
    console.error("POST /api/students", (e as Error).message, (e as Error).stack);
    return c.json({ error: (e as Error).message }, 400);
  }
});

api.patch("/api/students/:id", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | {
    name?: string; class_id?: string | null; gender?: "L" | "P" | null;
    nisn?: string | null; pin?: string;
  };
  if (!body) return c.json({ error: "bad body" }, 400);
  if (body.pin !== undefined && !/^\d{4,8}$/.test(body.pin)) return c.json({ error: "pin harus 4–8 digit" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const pin_hash = body.pin ? await hashPin(body.pin) : null;
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update students set
         name     = coalesce(${body.name ?? null}, name),
         class_id = case when ${body.class_id !== undefined} then ${body.class_id ?? null} else class_id end,
         gender   = case when ${body.gender !== undefined} then ${body.gender ?? null} else gender end,
         nisn     = case when ${body.nisn !== undefined}  then ${body.nisn ?? null}  else nisn end,
         pin_hash = coalesce(${pin_hash}, pin_hash),
         pin_failed_count = case when ${pin_hash !== null} then 0 else pin_failed_count end,
         locked_until     = case when ${pin_hash !== null} then null else locked_until end
       where id = ${id}
       returning id, name, username`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(r[0]);
});

// Import siswa dari CSV. Body: text/csv dengan header
//   name,username,class,gender,nisn,pin
// 'class' dicocokkan ke classes.name (case-sensitive). Baris gagal dilaporkan.
// Impor siswa (dari Excel yang dibaca di browser). Cukup nama + kelas; NISN,
// username, dan PIN opsional. Kelas yang belum ada dibuat otomatis. Balasan
// berisi username + PIN baru supaya bisa dicetak sebagai kartu login.
api.post("/api/students/import", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | { students: Array<{ name?: string; class?: string; nisn?: string; username?: string; pin?: string; gender?: string }> };
  const list = body?.students ?? [];
  if (list.length === 0) return c.json({ error: "Tidak ada siswa di file." }, 400);
  if (list.length > 300) return c.json({ error: "Maksimal 300 siswa sekali impor." }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const classes = new Map<string, string>();
    for (const r of await tx`select id, name from classes` as unknown as Array<{ id: string; name: string }>) classes.set(r.name.trim().toLowerCase(), r.id);
    const created: Array<{ name: string; class: string; username: string; pin: string }> = [];
    const fail: Array<{ row: number; error: string }> = [];
    const newClasses: string[] = [];
    const taken = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const r = list[i], row = i + 2;
      const name = String(r.name ?? "").trim(), cls = String(r.class ?? "").trim();
      if (!name) { fail.push({ row, error: "nama kosong" }); continue; }
      const pin = String(r.pin ?? "").trim() || newPin();
      if (!/^\d{4,8}$/.test(pin)) { fail.push({ row, error: "PIN harus 4–8 angka" }); continue; }
      const g = String(r.gender ?? "").trim().toUpperCase().charAt(0);
      let classId: string | null = null;
      if (cls) {
        classId = classes.get(cls.toLowerCase()) ?? null;
        if (!classId) {
          const ins = await tx`insert into classes (school_id, name, grade, year) values (${s.sid}, ${cls}, ${gradeOf(cls)}, ${schoolYear()}) returning id`;
          classId = (ins[0] as { id: string }).id; classes.set(cls.toLowerCase(), classId); newClasses.push(cls);
        }
      }
      try {
        const username = String(r.username ?? "").trim().toLowerCase() || await newUsername(tx, name, taken);
        taken.add(username);
        await tx`insert into students (school_id, class_id, name, username, gender, nisn, pin_hash)
          values (${s.sid}, ${classId}, ${name}, ${username}, ${g === "L" || g === "P" ? g : null}, ${String(r.nisn ?? "").trim() || null}, ${await hashPin(pin)})`;
        created.push({ name, class: cls, username, pin });
      } catch (e) { fail.push({ row, error: (e as Error).message.includes("duplicate") ? "username sudah dipakai" : (e as Error).message.slice(0, 100) }); }
    }
    await audit(tx, actorFromSession(s), "student.import", "student", null, { ok: created.length, fail: fail.length, classes: newClasses });
    return { ok: created.length, created, fail, newClasses };
  });
  return c.json(result);
});

const newPin = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

// "7A" → 7, "X-IPA-1" → 10, "XII" → 12; selain itu kosong.
function gradeOf(cls: string): number | null {
  const d = cls.match(/^\s*(\d{1,2})/); if (d) { const n = +d[1]; return n >= 1 && n <= 12 ? n : null; }
  const r = cls.toUpperCase().match(/^\s*(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/);
  return r ? ({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 } as Record<string, number>)[r[1]] : null;
}

// Username dari nama ("Andi Saputra" → "andi.saputra"), unik di semua sekolah
// karena siswa masuk tanpa kode sekolah.
async function newUsername(tx: postgres.TransactionSql, name: string, taken: Set<string>): Promise<string> {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").trim().split(/\s+/).slice(0, 2).join(".").slice(0, 24) || "siswa";
  for (let n = 1; n < 200; n++) {
    const u = n === 1 ? base : `${base}${n}`;
    if (taken.has(u)) continue;
    const hit = await tx`select 1 from find_students_by_username(${u}) limit 1`;
    if (hit.length === 0) return u;
  }
  return `${base}${Date.now() % 100000}`;
}

// Parser CSV minimal: dukung quoting standar (RFC 4180), newline di dalam quote.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Overview sekolah: angka kunci + aktivitas 30 hari terakhir.
api.get("/api/overview", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const [counts, active, online, byDay] = await Promise.all([
      tx`select
          (select count(*) from students where active) as students,
          (select count(*) from classes) as classes,
          (select count(*) from questions) as questions,
          (select count(*) from exams) as exams,
          (select count(*) from exam_sessions) as sessions,
          (select count(*) from exam_sessions where status = 'submitted') as submitted`,
      tx`select id, title, status, duration_minutes,
                (select count(*) from exam_sessions where exam_id = e.id and status = 'active') as active_now
         from exams e where e.status = 'open' order by created_at desc limit 10`,
      tx`select count(*)::int as n from exam_sessions
         where status = 'active' and last_seen_at > now() - interval '2 minutes'`,
      tx`select date_trunc('day', started_at)::date as day,
                count(*)::int as sessions,
                count(*) filter (where status = 'submitted')::int as submitted
         from exam_sessions
         where started_at > now() - interval '30 days'
         group by day order by day`,
    ]);
    return { counts: counts[0], active, online: (online[0] as { n: number }).n, by_day: byDay };
  });
  return c.json(data);
});

// ===== Staf (users: admin/teacher/proctor) =====

api.get("/api/users", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select id, email, name, role, active, google_sub is not null as linked
       from users order by email`,
  );
  return c.json(rows);
});

// Undang staf baru: tulis baris di users (role boleh admin/teacher/proctor).
// Google OAuth login kemudian memakai find_staff_by_email(email) untuk
// menemukan undangan ini dan membuat sesi.
api.post("/api/users", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "hanya admin yang boleh mengundang staf" }, 403);
  const body = await c.req.json().catch(() => null) as null | {
    email: string; name?: string; role: "admin"|"teacher"|"proctor";
  };
  if (!body?.email || !body?.role) return c.json({ error: "email dan role wajib" }, 400);
  if (!["admin","teacher","proctor"].includes(body.role)) return c.json({ error: "role tidak valid" }, 400);
  const email = body.email.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "format email salah" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  try {
    const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
      const u = await tx`insert into users (school_id, email, name, role)
         values (${s.sid}, ${email}, ${body.name ?? null}, ${body.role})
         returning id, email, role, active`;
      const sch = await tx`select name from schools where id = ${s.sid}`;
      await audit(tx, actorFromSession(s), "user.invite", "user",
        (u[0] as { id: string }).id, { email, role: body.role });
      return { user: u[0], schoolName: (sch[0] as { name: string } | undefined)?.name ?? "" };
    });
    // Kirim email undangan (best-effort, tidak gagalkan request).
    const mail = inviteEmail({ invitedEmail: email, schoolName: r.schoolName, role: body.role, origin: c.env.APP_ORIGIN });
    const sent = await sendEmail(c.env, email, mail.subject, mail.html);
    return c.json({ ...r.user, email_sent: sent.ok && !("skipped" in sent) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 409);
  }
});

api.patch("/api/users/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | {
    role?: "admin"|"teacher"|"proctor"; active?: boolean; name?: string;
  };
  if (!body) return c.json({ error: "bad body" }, 400);
  if (body.role && !["admin","teacher","proctor"].includes(body.role)) {
    return c.json({ error: "role tidak valid" }, 400);
  }
  // Cegah admin terakhir menonaktifkan dirinya sendiri atau kehilangan satu-satunya admin.
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    if ((body.role && body.role !== "admin") || body.active === false) {
      const target = await tx`select role from users where id = ${id}`;
      if (target.length && (target[0] as { role: string }).role === "admin") {
        const admins = await tx`select count(*)::int as n from users where role = 'admin' and active`;
        if ((admins[0] as { n: number }).n <= 1) throw new Error("tidak bisa menghapus satu-satunya admin aktif");
      }
    }
    return tx`update users set
      role   = coalesce(${body.role ?? null}, role),
      active = case when ${body.active !== undefined} then ${body.active ?? null} else active end,
      name   = coalesce(${body.name ?? null}, name)
      where id = ${id} returning id, email, role, active`;
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  if (result.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(result[0]);
});

api.delete("/api/users/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  if (c.req.param("id") === s.uid) return c.json({ error: "tidak boleh menghapus diri sendiri" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const target = await tx`select role from users where id = ${c.req.param("id")}`;
    if (target.length && (target[0] as { role: string }).role === "admin") {
      const admins = await tx`select count(*)::int as n from users where role = 'admin' and active`;
      if ((admins[0] as { n: number }).n <= 1) throw new Error("tidak bisa menghapus satu-satunya admin aktif");
    }
    return tx`delete from users where id = ${c.req.param("id")} returning id`;
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  if (result.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ===== Kategori soal =====

api.get("/api/categories", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select c.id, c.name, c.parent_id,
              (select count(*) from questions q where q.category_id = c.id) as question_count
       from categories c order by c.name`,
  );
  return c.json(rows);
});

api.post("/api/categories", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | { name: string; parent_id?: string | null };
  if (!body?.name) return c.json({ error: "nama kategori kosong" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into categories (school_id, name, parent_id)
       values (${s.sid}, ${body.name}, ${body.parent_id ?? null})
       returning id, name, parent_id`,
  );
  return c.json(r[0], 201);
});

api.delete("/api/categories/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`delete from categories where id = ${c.req.param("id")} returning id`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ===== Passages (bacaan reading comprehension) =====

api.get("/api/passages", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select id, title, body,
              (select count(*) from questions q where q.passage_id = p.id) as question_count
       from passages p order by p.title nulls last, p.id`,
  );
  return c.json(rows);
});

api.post("/api/passages", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | { title?: string; body: string };
  if (!body?.body) return c.json({ error: "body (teks bacaan) wajib" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into passages (school_id, title, body) values (${s.sid}, ${body.title ?? null}, ${body.body})
       returning id, title, body`,
  );
  return c.json(r[0], 201);
});

api.delete("/api/passages/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`delete from passages where id = ${c.req.param("id")} returning id`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ===== Bank soal =====

api.get("/api/questions", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const cat = c.req.query("category");
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    cat
      ? tx`select q.id, q.type, q.content - 'image' - 'audio' as content, q.points, q.category_id, k.answer_key, k.rubric
           from questions q left join question_keys k on k.question_id = q.id
           where q.category_id = ${cat}
           order by q.created_at desc limit 500`
      : tx`select q.id, q.type, q.content - 'image' - 'audio' as content, q.points, q.category_id, k.answer_key, k.rubric
           from questions q left join question_keys k on k.question_id = q.id
           order by q.created_at desc limit 500`,
  );
  return c.json(rows);
});

// POST /api/questions mendukung tipe:
//   pg          : {text, options[], correct}
//   benar_salah : {text, correct:boolean}
//   isian       : {text, accepted:string[]}  (dicocokkan case-insensitive, trim)
//   uraian      : {text, rubric?}            (manual grade only)
// Validasi + susun isi soal dari body editor (dipakai tambah & ubah soal).
type BuiltQuestion = { type: string; content: Record<string, unknown>; answer_key: unknown; rubric: string | null;
  points: number; categoryId: string | null; passageId: string | null; image: string | null; audio: string | null };
function buildQuestion(body: Record<string, unknown>): BuiltQuestion | { error: string; status: 400 | 413 } {
  const type = String(body.type || "pg");
  const text = String(body.text || "").trim();
  const points = typeof body.points === "number" ? body.points : 1;
  const categoryId = body.category_id ? String(body.category_id) : null;
  const passageId = body.passage_id ? String(body.passage_id) : null;
  // Gambar opsional, data URI, cap 400KB.
  const image = body.image ? String(body.image) : null;
  // Audio opsional (MP3/OGG/WAV/WebM), data URI, cap 600KB.
  const audio = body.audio ? String(body.audio) : null;
  if (!text && !image && !audio) return { error: "teks soal kosong", status: 400 };
  if (image) {
    if (!image.startsWith("data:image/")) return { error: "image harus data URI gambar", status: 400 };
    if (image.length > 400_000) return { error: "ukuran gambar > 400KB", status: 413 };
  }
  if (audio) {
    if (!audio.startsWith("data:audio/")) return { error: "audio harus data URI audio", status: 400 };
    if (audio.length > 600_000) return { error: "ukuran audio > 600KB", status: 413 };
  }

  let content: Record<string, unknown>; let answer_key: unknown; let rubric: string | null = null;
  if (type === "pg") {
    const options = Array.isArray(body.options) ? (body.options as string[]) : [];
    const correct = Number(body.correct);
    if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      return { error: "data pilihan ganda tidak valid", status: 400 };
    }
    content = { text, options }; answer_key = { index: correct };
  } else if (type === "benar_salah") {
    if (typeof body.correct !== "boolean") return { error: "'correct' harus boolean", status: 400 };
    content = { text, options: ["Benar", "Salah"] };
    answer_key = { index: body.correct ? 0 : 1 };
  } else if (type === "isian") {
    const accepted = Array.isArray(body.accepted) ? (body.accepted as string[])
      .map((x) => x.trim()).filter(Boolean) : [];
    if (accepted.length === 0) return { error: "jawaban yang diterima kosong", status: 400 };
    content = { text }; answer_key = { accepted };
  } else if (type === "uraian") {
    content = { text }; answer_key = { manual: true };
    rubric = body.rubric ? String(body.rubric) : null;
  } else if (type === "pgk_centang") {
    // Multiple-select. options = string[], correct_indexes = int[].
    const options = Array.isArray(body.options) ? (body.options as string[]) : [];
    const correctIdx = Array.isArray(body.correct_indexes)
      ? (body.correct_indexes as number[]).filter((n) => Number.isInteger(n) && n >= 0 && n < options.length) : [];
    if (options.length < 2 || correctIdx.length === 0) {
      return { error: "pgk_centang: butuh ≥2 opsi dan minimal 1 jawaban benar", status: 400 };
    }
    content = { text, options };
    answer_key = { correct: Array.from(new Set(correctIdx)).sort((a, b) => a - b) };
  } else if (type === "dinamis_hitung") {
    // Soal angka yang berbeda tiap siswa. Server generate nilai a & b di dalam
    // rentang [min, max], operator di antara + - × ÷. Siswa jawab bilangan
    // bulat atau pecahan. Pertanyaan: "<tpl>" dengan {a}, {b} di-replace.
    const a = body.a as { min: number; max: number } | undefined;
    const bRange = body.b as { min: number; max: number } | undefined;
    const op = String(body.op ?? "+");
    if (!a || !bRange || !["+","-","*","/"].includes(op) ||
        !Number.isInteger(a.min) || !Number.isInteger(a.max) ||
        !Number.isInteger(bRange.min) || !Number.isInteger(bRange.max) ||
        a.min > a.max || bRange.min > bRange.max) {
      return { error: "dinamis_hitung: a {min,max} + b {min,max} + op (+-*/) wajib", status: 400 };
    }
    const tpl = String(body.tpl ?? "{a} " + op + " {b} = ?");
    content = { text, tpl, a, b: bRange, op };
    answer_key = { formula: op };  // Formula sebenarnya di-compute di submit pakai nilai yang ter-generate.
  } else if (type === "simulasi") {
    // Simulasi: guru menulis HTML+JS yang dirender di iframe sandbox,
    // siswa menyimpan jawaban via postMessage. Scoring manual (uraian-like).
    const html = String(body.html ?? "").trim();
    if (!html) return { error: "html simulasi kosong", status: 400 };
    if (html.length > 20_000) return { error: "html terlalu besar (>20KB)", status: 413 };
    content = { text, html };
    answer_key = { manual: true };
    rubric = body.rubric ? String(body.rubric) : null;
  } else if (type === "menjodohkan") {
    // Matching. left & right: string[]. pairs: array of [leftIdx, rightIdx] canonical.
    const left = Array.isArray(body.left) ? (body.left as string[]).filter(Boolean) : [];
    const right = Array.isArray(body.right) ? (body.right as string[]).filter(Boolean) : [];
    if (left.length < 2 || right.length < left.length) {
      return { error: "menjodohkan: butuh minimal 2 pasangan dan right ≥ left", status: 400 };
    }
    // Kolom kanan diacak supaya pasangan tidak sejajar; kunci menyimpan posisi barunya.
    const order = right.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    content = { text, left, right: order.map((k) => right[k]) };
    answer_key = { pairs: left.map((_, i) => [i, order.indexOf(i)] as [number, number]) };
  } else {
    return { error: `tipe '${type}' belum didukung`, status: 400 };
  }
  if (image) content.image = image;
  if (audio) content.audio = audio;
  // Hint opsional (string). Siswa yang pakai hint kehilangan 50% poin soal
  // ini (dihandle di scoring submit).
  if (body.hint && typeof body.hint === "string") content.hint = String(body.hint).slice(0, 500);
  // Branching opsional: content.branches[option_index] = next_question_id.
  // Hanya untuk tipe dengan pilihan (pg, benar_salah). Klien merender dan
  // menerapkan logika navigasi — server tidak mengubah scoring.
  if (body.branches && typeof body.branches === "object") {
    const b: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.branches as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 10) b[k] = v;
    }
    if (Object.keys(b).length) content.branches = b;
  }

  return { type, content, answer_key, rubric, points, categoryId, passageId, image, audio };
}

api.post("/api/questions", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | Record<string, unknown>;
  if (!body) return c.json({ error: "bad body" }, 400);
  const q = buildQuestion(body);
  if ("error" in q) return c.json({ error: q.error }, q.status);
  const { type, content, answer_key, rubric, points, categoryId, passageId } = q;

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const q = await tx`insert into questions (school_id, author_id, type, content, points, category_id, passage_id)
      values (${s.sid}, ${s.uid}, ${type},
              ${content as unknown as string}, ${points}, ${categoryId}, ${passageId}) returning id`;
    const qid = (q[0] as { id: string }).id;
    await tx`insert into question_keys (question_id, school_id, answer_key, rubric)
      values (${qid}, ${s.sid}, ${answer_key as unknown as string}, ${rubric})`;
    return { id: qid, type };
  });
  return c.json(r, 201);
});

// Lab komputer mode: guru pilih siswa yang hadir dan mulai sesi serentak
// untuk mereka semua. Setiap siswa pakai akun masing-masing — ini bukan
// bypass auth, hanya pre-create session supaya tidak buang waktu klik
// Mulai satu-satu.
api.post("/api/exams/:id/lab-start", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const examId = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | { student_ids: string[] };
  if (!body || !Array.isArray(body.student_ids)) return c.json({ error: "bad body" }, 400);

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const ex = await tx`select status from exams where id = ${examId}`;
    if (ex.length === 0) throw new Error("ujian tidak ditemukan");
    if ((ex[0] as { status: string }).status !== "open") throw new Error("ujian harus berstatus open");
    const created: string[] = []; const skipped: Array<{ id: string; reason: string }> = [];
    for (const studentId of body.student_ids) {
      const exist = await tx`select id from exam_sessions where exam_id = ${examId} and student_id = ${studentId}`;
      if (exist.length) { skipped.push({ id: studentId, reason: "sudah punya sesi" }); continue; }
      try {
        created.push(await tx.savepoint((sp: typeof tx) => createSession(sp, s.sid, examId, studentId)));
      } catch (e) { skipped.push({ id: studentId, reason: (e as Error).message }); }
    }
    await audit(tx, actorFromSession(s), "exam.lab_start", "exam", examId,
      { created: created.length, skipped: skipped.length });
    return { created: created.length, skipped: skipped.length, skipped_detail: skipped };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result);
});

// Pause sesi (siswa izin keluar sebentar). Timer berhenti; saat resume,
// deadline bergeser sebesar durasi pause.
api.post("/api/sessions/:sid/pause", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sid = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update exam_sessions set paused_at = now()
      where id = ${sid} and status = 'active' and paused_at is null
      returning id, paused_at`;
    if (u.length) await audit(tx, actorFromSession(s), "session.pause", "session", sid);
    return u;
  });
  if (r.length === 0) return c.json({ error: "sesi tidak ditemukan / sudah pause" }, 404);
  return c.json({ ok: true, ...(r[0] as object) });
});

api.post("/api/sessions/:sid/resume", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sid = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update exam_sessions
      set deadline_at = deadline_at + (now() - paused_at),
          paused_at = null
      where id = ${sid} and paused_at is not null
      returning id, deadline_at`;
    if (u.length) await audit(tx, actorFromSession(s), "session.resume", "session", sid);
    return u;
  });
  if (r.length === 0) return c.json({ error: "sesi tidak dalam pause" }, 404);
  return c.json({ ok: true, ...(r[0] as object) });
});

// Perpanjang / potong deadline sesi individual (guru override timer).
api.post("/api/sessions/:sid/extend", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | { minutes: number };
  if (!body || typeof body.minutes !== "number") return c.json({ error: "minutes wajib (bilangan)" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update exam_sessions
      set deadline_at = deadline_at + make_interval(mins => ${body.minutes})
      where id = ${sessionId} and status = 'active'
      returning id, deadline_at`;
    if (u.length) await audit(tx, actorFromSession(s), "session.extend", "session", sessionId, { minutes: body.minutes });
    return u;
  });
  if (r.length === 0) return c.json({ error: "sesi tidak ditemukan atau tidak aktif" }, 404);
  return c.json({ ok: true, ...(r[0] as object) });
});

// Paksa submit sesi yang masih aktif (siswa tertinggal, atau proctor
// memutuskan menutup lebih awal). Hitung auto-score seperti submit normal.
api.post("/api/sessions/:sid/force-submit", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const ses = await tx`select exam_id, student_id, school_id, status from exam_sessions where id = ${sessionId}`;
    if (ses.length === 0) throw new Error("sesi tidak ditemukan");
    const row = ses[0] as { exam_id: string; student_id: string; school_id: string; status: string };
    if (row.status === "submitted") return { already: true };
    const out = await finalizeSession(tx, sessionId, "submitted");
    await audit(tx, actorFromSession(s), "session.force_submit", "session", sessionId, { score: out.score });
    return { ok: true, ...out };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in r) return c.json(r, 400);
  return c.json(r);
});

// Buka kembali sesi yang di-locked oleh anti-cheat. Reset violation_count
// supaya siswa tidak langsung terkunci lagi di event berikutnya.
api.post("/api/sessions/:sid/unlock", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update exam_sessions set status = 'active', violation_count = 0, unlock_code = null, unlock_tries = 0,
       deadline_at = greatest(deadline_at, now() + interval '15 minutes')
       where id = ${sessionId} and status = 'locked' returning id, deadline_at`;
    if (u.length) await audit(tx, actorFromSession(s), "session.unlock", "session", sessionId);
    return u;
  });
  if (r.length === 0) return c.json({ error: "sesi tidak ditemukan atau tidak terkunci" }, 404);
  return c.json({ ok: true, ...(r[0] as object) });
});

// Antrian permintaan reset PIN dari siswa.
api.get("/api/pin-resets", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select pr.id, pr.student_id, pr.status, pr.requested_at, pr.approved_at, pr.new_pin,
              st.name as student_name, st.username
       from pin_resets pr join students st on st.id = pr.student_id
       where pr.status = 'pending' or pr.new_pin is not null
       order by pr.requested_at desc`,
  );
  return c.json(rows);
});

// Setujui reset PIN: generate 6 digit acak, simpan hash, kembalikan ke guru
// SATU KALI (dikosongkan di request yang sama di call berikutnya).
api.post("/api/pin-resets/:id/approve", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const prId = c.req.param("id");
  // Generate 6 digit acak crypto.
  const buf = new Uint8Array(4); crypto.getRandomValues(buf);
  const n = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  const newPin = String(n % 1_000_000).padStart(6, "0");
  const pin_hash = await hashPin(newPin);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const pr = await tx`select student_id, status from pin_resets where id = ${prId}`;
    if (pr.length === 0) throw new Error("permintaan tidak ditemukan");
    if ((pr[0] as { status: string }).status !== "pending") throw new Error("permintaan sudah diproses");
    const stuId = (pr[0] as { student_id: string }).student_id;
    await tx`update students set pin_hash = ${pin_hash}, pin_failed_count = 0, locked_until = null
             where id = ${stuId}`;
    await tx`update pin_resets set status = 'approved', approved_by = ${s.uid}, approved_at = now(),
             new_pin = ${newPin} where id = ${prId}`;
    await audit(tx, actorFromSession(s), "pin_reset.approve", "student", stuId, { request_id: prId });
    return { student_id: stuId };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in r) return c.json(r, 400);
  return c.json({ ok: true, pin: newPin, ...r });
});

// Hapus pin plain-text setelah guru klik "sudah disampaikan ke siswa".
api.post("/api/pin-resets/:id/clear", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update pin_resets set new_pin = null where id = ${c.req.param("id")}`,
  );
  return c.json({ ok: true });
});

api.post("/api/pin-resets/:id/reject", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update pin_resets set status = 'rejected', approved_by = ${s.uid}, approved_at = now()
       where id = ${c.req.param("id")} and status = 'pending'`,
  );
  return c.json({ ok: true });
});

// ===== Bulk operations =====

// Set / ubah email wali siswa.
api.patch("/api/students/:id/guardian", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | { email: string | null };
  if (!body) return c.json({ error: "bad body" }, 400);
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: "format email salah" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update students set guardian_email = ${email} where id = ${id} returning id, guardian_email`,
  );
  if (r.length === 0) return c.json({ error: "siswa tidak ditemukan" }, 404);
  return c.json(r[0]);
});

// Kirim rapor siswa ke email wali sekarang (best-effort via Resend).
api.post("/api/students/:id/send-report", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const info = await tx`select s.name, s.guardian_email, sch.name as school_name
                           from students s join schools sch on sch.id = s.school_id
                           where s.id = ${id}`;
    if (info.length === 0) return null;
    const scores = await tx`select e.title, sc.final_score, es.finished_at
                             from exam_sessions es
                             join exams e on e.id = es.exam_id
                             left join scores sc on sc.session_id = es.id
                             where es.student_id = ${id} and es.status = 'submitted'
                             order by es.finished_at desc limit 20`;
    return { info: info[0], scores };
  });
  if (!data) return c.json({ error: "siswa tidak ditemukan" }, 404);
  const info = data.info as { name: string; guardian_email: string | null; school_name: string };
  if (!info.guardian_email) return c.json({ error: "email wali belum di-set" }, 400);
  type S = { title: string; final_score: string | null; finished_at: string };
  const scores = data.scores as unknown as S[];
  const rows = scores.map((r) => `<tr>
    <td style="padding:6px 10px; border-bottom:1px solid #eee">${esc2(r.title)}</td>
    <td style="padding:6px 10px; border-bottom:1px solid #eee; text-align:right"><b>${r.final_score ?? "-"}</b></td>
    <td style="padding:6px 10px; border-bottom:1px solid #eee; color:#666">${new Date(r.finished_at).toLocaleDateString("id-ID")}</td>
  </tr>`).join("");
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:auto;padding:20px">
      <h2>Rapor ${esc2(info.name)}</h2>
      <p>Berikut hasil ujian terbaru di <b>${esc2(info.school_name)}</b>:</p>
      <table style="width:100%; border-collapse:collapse; margin-top:12px">
        <thead><tr style="background:#f3f4f6"><th style="padding:6px 10px; text-align:left">Ujian</th><th style="padding:6px 10px; text-align:right">Nilai</th><th style="padding:6px 10px; text-align:left">Tanggal</th></tr></thead>
        <tbody>${rows || `<tr><td colspan=3 style="padding:6px 10px; color:#999">Belum ada ujian.</td></tr>`}</tbody>
      </table>
    </div>`;
  const sent = await sendEmail(c.env, info.guardian_email, `Rapor ${info.name}`, html);
  return c.json({ ok: sent.ok, skipped: "skipped" in sent, to: info.guardian_email });
});

// Reset PIN semua siswa aktif di satu kelas. Admin menerima daftar
// {username, pin} satu kali untuk dibagikan.
api.post("/api/classes/:id/reset-pins", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "hanya admin" }, 403);
  const classId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const stus = await tx`select id, username, name from students where class_id = ${classId} and active`;
    const out: Array<{ username: string; name: string; pin: string }> = [];
    for (const row of stus as unknown as Array<{ id: string; username: string; name: string }>) {
      const buf = new Uint8Array(4); crypto.getRandomValues(buf);
      const n = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
      const pin = String(n % 1_000_000).padStart(6, "0");
      const hash = await hashPin(pin);
      await tx`update students set pin_hash = ${hash}, pin_failed_count = 0, locked_until = null
               where id = ${row.id}`;
      out.push({ username: row.username, name: row.name, pin });
    }
    await audit(tx, actorFromSession(s), "class.reset_pins", "class", classId, { count: out.length });
    return out;
  });
  return c.json({ ok: true, count: result.length, students: result });
});

// Hapus semua sesi (dan jawaban/skor) sebuah ujian — berguna untuk ujian
// ulang total atau cleanup test data.
api.post("/api/exams/:id/wipe-sessions", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "hanya admin" }, 403);
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const d = await tx`delete from exam_sessions where exam_id = ${examId} returning id`;
    await audit(tx, actorFromSession(s), "exam.wipe_sessions", "exam", examId, { count: d.length });
    return d.length;
  });
  return c.json({ ok: true, deleted: result });
});

// Archive ujian: set status 'closed' untuk semua ujian berumur > N hari
// dan masih open/scheduled. Payload: { older_than_days: 30 }.
api.post("/api/exams/bulk-archive", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "hanya admin" }, 403);
  const body = await c.req.json().catch(() => null) as null | { older_than_days?: number };
  const days = Math.max(1, Math.min(365, body?.older_than_days ?? 30));
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update exams set status = 'closed'
      where status in ('open','scheduled') and created_at < now() - make_interval(days => ${days})
      returning id`;
    await audit(tx, actorFromSession(s), "exam.bulk_archive", null, null, { count: u.length, days });
    return u.length;
  });
  return c.json({ ok: true, archived: r, days });
});

// Reset PIN siswa (admin/guru). Body: { pin: "4-8 digit" }
api.post("/api/students/:id/reset-pin", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | { pin: string };
  if (!body?.pin || !/^\d{4,8}$/.test(body.pin)) return c.json({ error: "pin harus 4-8 digit" }, 400);
  const pin_hash = await hashPin(body.pin);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update students set pin_hash = ${pin_hash},
         pin_failed_count = 0, locked_until = null
       where id = ${id} returning id`,
  );
  if (r.length === 0) return c.json({ error: "siswa tidak ditemukan" }, 404);
  return c.json({ ok: true });
});

// Nilai manual untuk soal uraian: input per sesi × soal.
api.post("/api/sessions/:sid/manual-score", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | {
    scores: Array<{ question_id: string; score: number }>;
  };
  if (!body?.scores) return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const out = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    // Simpan nilai manual di answers.answer (merge ke objek yang ada) agar
    // audit tetap kelihatan dan agar aggregasi tetap lewat satu tabel.
    for (const row of body.scores) {
      await tx`update answers
        set answer = coalesce(answer, '{}'::jsonb) || ${{ manual_score: row.score } as unknown as string}
        where session_id = ${sessionId} and question_id = ${row.question_id}`;
    }
    const sess = await tx`select exam_id, student_id, status from exam_sessions where id = ${sessionId}`;
    if (sess.length === 0) throw new Error("sesi tidak ditemukan");
    const r = sess[0] as { exam_id: string; student_id: string };
    const sc = await writeScore(tx, sessionId, r.exam_id, r.student_id, s.sid, s.uid);
    return { ok: true, final: sc.score };
  });
  return c.json(out);
});

// Publikasikan bank soal: pilih kategori (atau semua), buat shared_banks
// dengan slug URL-safe. Siapa saja bisa unduh via /public/banks/:slug.
api.post("/api/shared-banks", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | {
    slug: string; title: string; description?: string; category_id?: string | null;
  };
  if (!body?.slug || !body?.title) return c.json({ error: "slug dan title wajib" }, 400);
  if (!/^[a-z0-9-]{3,64}$/.test(body.slug)) return c.json({ error: "slug: huruf kecil/digit/strip 3-64" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    // Kunci jawaban ikut terbit — tolak bila ada soal yang masih dipakai ujian berjalan/terjadwal.
    const live = await tx`select count(distinct q.id)::int as n from questions q
      join exam_questions eq on eq.question_id = q.id
      join exams e on e.id = eq.exam_id and e.status in ('open', 'scheduled')
      where ${body.category_id ?? null}::uuid is null or q.category_id = ${body.category_id ?? null}::uuid`;
    const n = (live[0] as { n: number }).n;
    if (n > 0) throw new Error(`${n} soal masih dipakai ujian yang terbuka/terjadwal. Terbitkan setelah ujian ditutup.`);
    const qs = body.category_id
      ? await tx`select q.type, q.content, q.points, k.answer_key, k.rubric
                  from questions q left join question_keys k on k.question_id = q.id
                  where q.category_id = ${body.category_id}`
      : await tx`select q.type, q.content, q.points, k.answer_key, k.rubric
                  from questions q left join question_keys k on k.question_id = q.id`;
    const payload = { version: 1, exported_at: new Date().toISOString(),
      questions: qs };
    const ins = await tx`insert into shared_banks (school_id, slug, title, description, payload, created_by)
      values (${s.sid}, ${body.slug}, ${body.title}, ${body.description ?? null},
              ${payload as unknown as string}, ${s.uid})
      returning id, slug, title`;
    await audit(tx, actorFromSession(s), "bank.publish", "shared_bank",
      (ins[0] as { id: string }).id, { slug: body.slug, count: (qs as unknown as unknown[]).length });
    return { ...(ins[0] as object), count: (qs as unknown as unknown[]).length };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result, 201);
});

// Katalog bank soal publik semua sekolah.
api.get("/api/public-banks", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select * from list_public_banks()`);
  return c.json(rows);
});

// Soal tersimpan (content + kunci) → bentuk body editor, supaya bisa lewat buildQuestion.
function bodyFromStored(q: { type: string; content: Record<string, unknown>; answer_key: Record<string, unknown> | null; rubric: string | null; points: unknown }) {
  const k = q.answer_key ?? {}, ct = q.content;
  const b: Record<string, unknown> = { type: q.type, text: ct.text, points: Number(q.points) || 1 };
  if (typeof ct.image === "string") b.image = ct.image;
  if (q.type === "pg") { b.options = ct.options; b.correct = k.index; }
  else if (q.type === "benar_salah") b.correct = k.index === 0;
  else if (q.type === "pgk_centang") { b.options = ct.options; b.correct_indexes = k.correct; }
  else if (q.type === "isian") b.accepted = k.accepted;
  else if (q.type === "uraian") b.rubric = q.rubric;
  else if (q.type === "menjodohkan") {
    const left = (ct.left as string[]) ?? [], right = (ct.right as string[]) ?? [];
    const pairs = (k.pairs as [number, number][]) ?? [];
    b.left = left; b.right = left.map((_, i) => right[pairs.find((p) => p[0] === i)?.[1] ?? i]);
  }
  return b;
}

// Salin isi bank publik ke bank soal sekolah sendiri (kategori = judul bank).
api.post("/api/public-banks/:slug/save", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const slug = c.req.param("slug");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const out = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const r = await tx`select title, payload from public_bank(${slug})`;
    if (r.length === 0) return null;
    const bank = r[0] as { title: string; payload: { questions: Array<{ type: string; content: Record<string, unknown>; answer_key: Record<string, unknown> | null; rubric: string | null; points: unknown }> } };
    const cat = await tx`select id from categories where lower(name) = lower(${bank.title})`;
    const catId = cat.length ? (cat[0] as { id: string }).id
      : ((await tx`insert into categories (school_id, name) values (${s.sid}, ${bank.title}) returning id`)[0] as { id: string }).id;
    let ok = 0, skip = 0;
    for (const raw of bank.payload.questions ?? []) {
      const q = buildQuestion({ ...bodyFromStored(raw), category_id: catId });
      if ("error" in q) { skip++; continue; }
      const ins = await tx`insert into questions (school_id, author_id, type, content, points, category_id)
        values (${s.sid}, ${s.uid}, ${q.type}, ${q.content as unknown as string}, ${q.points}, ${q.categoryId}) returning id`;
      await tx`insert into question_keys (question_id, school_id, answer_key, rubric)
        values (${(ins[0] as { id: string }).id}, ${s.sid}, ${q.answer_key as unknown as string}, ${q.rubric})`;
      ok++;
    }
    await tx`select increment_bank_download(${slug})`;
    await audit(tx, actorFromSession(s), "bank.save", "shared_bank", null, { slug, ok, skip });
    return { ok, skip, category: bank.title };
  });
  if (!out) return c.json({ error: "bank tidak ditemukan" }, 404);
  return c.json(out);
});

api.get("/api/shared-banks", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select id, slug, title, description, download_count, created_at,
              jsonb_array_length(payload->'questions') as question_count
       from shared_banks order by created_at desc`,
  );
  return c.json(rows);
});

api.delete("/api/shared-banks/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`delete from shared_banks where id = ${c.req.param("id")} returning id`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Export bank soal ke CSV (round-trip dengan /api/questions/import).
api.get("/api/questions/export.csv", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select q.type, q.content, q.points, k.answer_key, k.rubric, cat.name as category
       from questions q
       left join question_keys k on k.question_id = q.id
       left join categories cat on cat.id = q.category_id
       order by q.created_at desc`,
  );
  type R = { type: string; content: { text: string; options?: string[] }; points: string;
    answer_key: { index?: number; accepted?: string[] } | null; rubric: string | null; category: string | null };
  const esc = (v: unknown) => {
    if (v == null) return "";
    const t = typeof v === "string" ? v : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = ["type,text,options,correct,accepted,rubric,points,category"];
  for (const r of rows as unknown as R[]) {
    let options = "", correct = "", accepted = "";
    if (r.type === "pg") {
      options = (r.content.options ?? []).join("|");
      correct = r.answer_key?.index != null ? String(r.answer_key.index) : "";
    } else if (r.type === "benar_salah") {
      correct = r.answer_key?.index === 0 ? "true" : "false";
    } else if (r.type === "isian") {
      accepted = (r.answer_key?.accepted ?? []).join("|");
    }
    lines.push([r.type, r.content.text, options, correct, accepted, r.rubric, r.points, r.category].map(esc).join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bank-soal.csv"`,
    },
  });
});

// Import bank soal dari CSV. Format header:
//   type,text,options,correct,accepted,rubric,points,category
// options & accepted dipisah dengan '|'. correct untuk pg = index 0-based,
// untuk benar_salah = true/false. Category dicocokkan dengan nama.
api.post("/api/questions/import", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const text = await c.req.text();
  const rows = parseCsv(text);
  if (rows.length === 0) return c.json({ error: "csv kosong" }, 400);
  const header = rows[0].map((x) => x.toLowerCase().trim());
  const idx: Record<string, number> = {};
  for (const k of ["type","text","options","correct","accepted","rubric","points","category"]) {
    idx[k] = header.indexOf(k);
  }
  if (idx.type < 0 || idx.text < 0) {
    return c.json({ error: "header wajib: type, text (opsional: options, correct, accepted, rubric, points, category)" }, 400);
  }
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const cats = await tx`select id, name from categories`;
    const catMap = new Map<string, string>();
    for (const r of cats as unknown as Array<{ id: string; name: string }>) catMap.set(r.name, r.id);
    const ok: string[] = []; const fail: { row: number; error: string }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (r.length <= 1 && (!r[0] || r[0] === "")) continue;
      const type = r[idx.type]?.trim();
      const qtext = r[idx.text]?.trim();
      const points = idx.points >= 0 && r[idx.points] ? parseFloat(r[idx.points]) : 1;
      const catName = idx.category >= 0 ? r[idx.category]?.trim() : "";
      const categoryId: string | null = catName ? (catMap.get(catName) ?? null) : null;
      if (catName && !categoryId) { fail.push({ row: i + 1, error: `kategori '${catName}' tidak ada` }); continue; }
      if (!type || !qtext) { fail.push({ row: i + 1, error: "type/text kosong" }); continue; }

      let content: Record<string, unknown>; let answer_key: unknown; let rubric: string | null = null;
      if (type === "pg") {
        const options = (r[idx.options] ?? "").split("|").map((x) => x.trim()).filter(Boolean);
        const correct = parseInt((r[idx.correct] ?? "").trim(), 10);
        if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
          fail.push({ row: i + 1, error: "pg: butuh ≥2 opsi (|) dan correct index valid" }); continue;
        }
        content = { text: qtext, options }; answer_key = { index: correct };
      } else if (type === "benar_salah") {
        const v = (r[idx.correct] ?? "").trim().toLowerCase();
        if (v !== "true" && v !== "false" && v !== "benar" && v !== "salah") {
          fail.push({ row: i + 1, error: "benar_salah: correct harus true/false/benar/salah" }); continue;
        }
        const isTrue = v === "true" || v === "benar";
        content = { text: qtext, options: ["Benar", "Salah"] }; answer_key = { index: isTrue ? 0 : 1 };
      } else if (type === "isian") {
        const accepted = (r[idx.accepted] ?? "").split("|").map((x) => x.trim()).filter(Boolean);
        if (accepted.length === 0) { fail.push({ row: i + 1, error: "isian: accepted kosong" }); continue; }
        content = { text: qtext }; answer_key = { accepted };
      } else if (type === "uraian") {
        content = { text: qtext }; answer_key = { manual: true };
        rubric = idx.rubric >= 0 ? (r[idx.rubric] ?? "").trim() || null : null;
      } else {
        fail.push({ row: i + 1, error: `tipe '${type}' tidak didukung` }); continue;
      }
      try {
        const q = await tx`insert into questions
          (school_id, author_id, type, content, points, category_id)
          values (${s.sid}, ${s.uid}, ${type}, ${content as unknown as string}, ${points}, ${categoryId})
          returning id`;
        const qid = (q[0] as { id: string }).id;
        await tx`insert into question_keys (question_id, school_id, answer_key, rubric)
          values (${qid}, ${s.sid}, ${answer_key as unknown as string}, ${rubric})`;
        ok.push(qid);
      } catch (e) {
        fail.push({ row: i + 1, error: (e as Error).message.slice(0, 120) });
      }
    }
    return { ok: ok.length, fail };
  });
  return c.json(result);
});

// Unggah banyak soal sekaligus (dari Excel yang dibaca di browser). Setiap
// baris memakai aturan yang sama dengan editor; kategori dibuat bila belum ada.
api.post("/api/questions/bulk", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | { questions: Array<Record<string, unknown>> };
  if (!body || !Array.isArray(body.questions) || body.questions.length === 0) return c.json({ error: "tidak ada soal" }, 400);
  if (body.questions.length > 500) return c.json({ error: "maksimal 500 soal sekali unggah" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const cats = new Map<string, string>();
    for (const r of await tx`select id, name from categories` as unknown as Array<{ id: string; name: string }>) cats.set(r.name.toLowerCase(), r.id);
    let ok = 0; const ids: string[] = []; const fail: Array<{ row: number; error: string }> = [];
    for (let i = 0; i < body.questions.length; i++) {
      const row = { ...body.questions[i] };
      const cname = typeof row.category_name === "string" ? row.category_name.trim() : "";
      if (cname) {
        let cid = cats.get(cname.toLowerCase());
        if (!cid) {
          const ins = await tx`insert into categories (school_id, name) values (${s.sid}, ${cname}) returning id`;
          cid = (ins[0] as { id: string }).id; cats.set(cname.toLowerCase(), cid);
        }
        row.category_id = cid;
      }
      const q = buildQuestion(row);
      if ("error" in q) { fail.push({ row: Number(row.row ?? i + 2), error: q.error }); continue; }
      const ins = await tx`insert into questions (school_id, author_id, type, content, points, category_id)
        values (${s.sid}, ${s.uid}, ${q.type}, ${q.content as unknown as string}, ${q.points}, ${q.categoryId}) returning id`;
      const qid = (ins[0] as { id: string }).id;
      await tx`insert into question_keys (question_id, school_id, answer_key, rubric)
        values (${qid}, ${s.sid}, ${q.answer_key as unknown as string}, ${q.rubric})`;
      ok++; ids.push(qid);
    }
    await audit(tx, actorFromSession(s), "question.bulk", "question", null, { ok, fail: fail.length });
    return { ok, ids, fail };
  });
  return c.json(result);
});

// Satu soal lengkap (dengan gambar/audio & kunci) untuk editor.
api.get("/api/questions/:id", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select q.id, q.type, q.content, q.points, q.category_id, q.passage_id, k.answer_key, k.rubric,
              (select count(*) from exam_questions eq join exams e on e.id = eq.exam_id
               where eq.question_id = q.id and e.status in ('open','scheduled'))::int as live_exams
       from questions q left join question_keys k on k.question_id = q.id where q.id = ${c.req.param("id")}`);
  if (r.length === 0) return c.json({ error: "soal tidak ditemukan" }, 404);
  return c.json(r[0]);
});

// Ubah soal. Gambar/audio lama dipertahankan bila body tidak menyertakannya
// (image: "" untuk menghapus).
api.patch("/api/questions/:id", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | Record<string, unknown>;
  if (!body) return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const old = await tx`select content, passage_id from questions where id = ${id}`;
    if (old.length === 0) return { error: "soal tidak ditemukan", status: 404 as const };
    const prev = (old[0] as { content: Record<string, unknown>; passage_id: string | null });
    const merged = { ...body };
    if (merged.image === undefined && prev.content.image) merged.image = prev.content.image;
    if (merged.audio === undefined && prev.content.audio) merged.audio = prev.content.audio;
    if (merged.image === "") delete merged.image;
    if (merged.audio === "") delete merged.audio;
    if (merged.passage_id === undefined) merged.passage_id = prev.passage_id;
    if (merged.hint === undefined && prev.content.hint) merged.hint = prev.content.hint;
    const q = buildQuestion(merged);
    if ("error" in q) return q;
    await tx`update questions set type = ${q.type}, content = ${q.content as unknown as string}, points = ${q.points},
               category_id = ${q.categoryId}, passage_id = ${q.passageId}, updated_at = now() where id = ${id}`;
    await tx`insert into question_keys (question_id, school_id, answer_key, rubric)
             values (${id}, ${s.sid}, ${q.answer_key as unknown as string}, ${q.rubric})
             on conflict (question_id) do update set answer_key = excluded.answer_key, rubric = excluded.rubric`;
    await audit(tx, actorFromSession(s), "question.update", "question", id);
    return { ok: true, id };
  });
  if ("error" in r) return c.json({ error: r.error }, r.status);
  return c.json(r);
});

api.delete("/api/questions/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`delete from questions where id = ${c.req.param("id")} returning id`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Auto-generate ujian dari bank soal. Body: {title, duration_minutes,
// counts: {pg?: n, benar_salah?: n, isian?: n, uraian?: n, …},
// category_ids?: [uuid], kind?: harian/…}
// Soal dipilih acak per tipe. Ujian baru dibuat dengan status draft dan
// soal yang terpilih di-attach.
api.post("/api/exams/generate", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | {
    title: string; duration_minutes: number; kind?: string;
    counts: Record<string, number>; category_ids?: string[];
  };
  if (!body?.title || !body.duration_minutes || !body.counts) return c.json({ error: "data kurang" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const picked: string[] = []; const detail: Record<string, number> = {};
    for (const [type, countAny] of Object.entries(body.counts)) {
      const count = Math.max(0, Math.floor(Number(countAny) || 0));
      if (count === 0) continue;
      const rows = body.category_ids && body.category_ids.length
        ? await tx`select id from questions where type = ${type}
                   and category_id in ${tx(body.category_ids)}
                   order by random() limit ${count}`
        : await tx`select id from questions where type = ${type}
                   order by random() limit ${count}`;
      const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
      for (const id of ids) picked.push(id);
      detail[type] = ids.length;
    }
    if (picked.length === 0) throw new Error("tidak ada soal yang cocok dengan filter");
    const ins = await tx`insert into exams (school_id, creator_id, title, kind, duration_minutes, status)
      values (${s.sid}, ${s.uid}, ${body.title}, ${body.kind ?? "tryout"}, ${body.duration_minutes}, 'draft')
      returning id`;
    const examId = (ins[0] as { id: string }).id;
    for (let i = 0; i < picked.length; i++) {
      await tx`insert into exam_questions (exam_id, question_id, school_id, position)
               values (${examId}, ${picked[i]}, ${s.sid}, ${i + 1})`;
    }
    await audit(tx, actorFromSession(s), "exam.generate", "exam", examId, { picked: detail });
    return { exam_id: examId, picked: detail, total: picked.length };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result);
});

// ===== Grup ujian (rangkaian) =====

api.get("/api/exam-groups", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select g.id, g.title, g.description, g.strict_order,
              (select count(*) from exams e where e.group_id = g.id) as exam_count
       from exam_groups g order by g.created_at desc`,
  );
  return c.json(rows);
});

api.post("/api/exam-groups", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | { title: string; description?: string; strict_order?: boolean };
  if (!body?.title) return c.json({ error: "judul wajib" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into exam_groups (school_id, title, description, strict_order)
       values (${s.sid}, ${body.title}, ${body.description ?? null}, ${body.strict_order ?? true})
       returning id, title, strict_order`,
  );
  return c.json(r[0], 201);
});

api.delete("/api/exam-groups/:id", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`delete from exam_groups where id = ${c.req.param("id")} returning id`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// ===== Ujian =====

api.get("/api/exams", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select e.id, e.title, e.kind, e.duration_minutes, e.status,
              (select count(*) from exam_questions eq where eq.exam_id = e.id) as question_count,
              (select count(*) from exam_classes ec where ec.exam_id = e.id) as class_count
       from exams e order by e.created_at desc`,
  );
  return c.json(rows);
});

api.post("/api/exams", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | {
    title: string; kind: string; duration_minutes: number;
    starts_at?: string | null; ends_at?: string | null;
    shuffle_questions?: boolean; shuffle_options?: boolean;
    anticheat_level?: "log"|"warn"|"lock"; lock_after_violations?: number | null;
    questions_per_session?: number;
    scoring_config?: { wrong_penalty?: number; category_weights?: Record<string, number> };
    group_id?: string | null; group_position?: number | null;
  };
  if (!body?.title || !body.kind?.trim() || !body.duration_minutes) return c.json({ error: "data ujian kurang" }, 400);
  body.kind = body.kind.trim().slice(0, 60);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into exams (school_id, creator_id, title, kind, duration_minutes,
         starts_at, ends_at, shuffle_questions, shuffle_options, anticheat_level, lock_after_violations,
         questions_per_session, scoring_config, group_id, group_position)
       values (${s.sid}, ${s.uid}, ${body.title}, ${body.kind}, ${body.duration_minutes},
         ${body.starts_at ?? null}, ${body.ends_at ?? null},
         ${body.shuffle_questions ?? false}, ${body.shuffle_options ?? false},
         ${body.anticheat_level ?? "log"}, ${body.lock_after_violations ?? null},
         ${body.questions_per_session ?? 0},
         ${(body.scoring_config ?? {}) as unknown as string},
         ${body.group_id ?? null}, ${body.group_position ?? null})
       returning id`,
  );
  return c.json(r[0], 201);
});

api.patch("/api/exams/:id", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | {
    status?: "draft"|"scheduled"|"open"|"closed"; title?: string; duration_minutes?: number;
    starts_at?: string | null; ends_at?: string | null;
    shuffle_questions?: boolean; shuffle_options?: boolean;
    anticheat_level?: "log"|"warn"|"lock"; lock_after_violations?: number | null;
    questions_per_session?: number;
  };
  if (!body) return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update exams set
       title = coalesce(${body.title ?? null}, title),
       duration_minutes = coalesce(${body.duration_minutes ?? null}, duration_minutes),
       status = coalesce(${body.status ?? null}, status),
       starts_at = case when ${body.starts_at !== undefined} then ${body.starts_at ?? null} else starts_at end,
       ends_at = case when ${body.ends_at !== undefined} then ${body.ends_at ?? null} else ends_at end,
       shuffle_questions = coalesce(${body.shuffle_questions ?? null}, shuffle_questions),
       shuffle_options = coalesce(${body.shuffle_options ?? null}, shuffle_options),
       anticheat_level = coalesce(${body.anticheat_level ?? null}, anticheat_level),
       lock_after_violations = case when ${body.lock_after_violations !== undefined}
          then ${body.lock_after_violations ?? null} else lock_after_violations end,
       questions_per_session = coalesce(${body.questions_per_session ?? null}, questions_per_session)
     where id = ${id} returning id, status`;
    if (u.length && body.status) {
      await audit(tx, actorFromSession(s), `exam.${body.status}`, "exam", id, { title: body.title ?? null });
    }
    return u;
  });
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(r[0]);
});

// Analytics per siswa: tren skor + persen benar per kategori.
api.get("/api/students/:id/analytics", async (c) => {
  const s = getSess(c);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const info = await tx`select name, username from students where id = ${id}`;
    if (info.length === 0) return null;
    const timeline = await tx`
      select e.title, es.finished_at, sc.final_score
      from exam_sessions es
      join exams e on e.id = es.exam_id
      left join scores sc on sc.session_id = es.id
      where es.student_id = ${id} and es.status = 'submitted'
      order by es.finished_at`;
    // Persen benar per kategori: hitung soal + benar dari semua jawaban siswa.
    const [byCat, violations] = await Promise.all([
      tx`
      select coalesce(cat.name, '(tanpa kategori)') as category,
             count(*)::int as total,
             sum(case
               when q.type = 'pg'          and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'benar_salah' and (k.answer_key->>'index')::int = (a.answer->>'index')::int then 1
               when q.type = 'isian'       and exists(
                 select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                 where lower(trim(x.value)) = lower(trim(a.answer->>'text'))) then 1
               when q.type = 'pgk_centang' and (
                 select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(k.answer_key->'correct') x
               ) = (
                 select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(a.answer->'selected') x
               ) then 1
               when q.type = 'menjodohkan' and a.answer->'pairs' = k.answer_key->'pairs' then 1
               when q.type = 'uraian' and (a.answer->>'manual_score')::numeric >= q.points * 0.5 then 1
               else 0 end)::int as benar
      from answers a
      join questions q on q.id = a.question_id
      join exam_sessions es on es.id = a.session_id
      left join question_keys k on k.question_id = q.id
      left join categories cat on cat.id = q.category_id
      where es.student_id = ${id} and es.status = 'submitted'
      group by cat.name order by cat.name`,
      tx`
      select count(*)::int as n, kind
      from violations v join exam_sessions es on es.id = v.session_id
      where es.student_id = ${id} group by kind order by kind`,
    ]);
    return { info: info[0], timeline, byCat, violations };
  });
  if (!data) return c.json({ error: "siswa tidak ditemukan" }, 404);
  return c.json(data);
});

// Chat ujian: list + post dari sisi staf.
api.get("/api/sessions/:sid/messages", async (c) => {
  const s = getSess(c);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select id, from_role, from_name, content, created_at from exam_messages
       where session_id = ${sessionId} order by created_at asc limit 100`,
  );
  return c.json(rows);
});

api.post("/api/sessions/:sid/messages", async (c) => {
  const s = getSess(c);
  const sessionId = c.req.param("sid");
  const body = await c.req.json().catch(() => null) as null | { content: string };
  if (!body?.content || body.content.length > 500) return c.json({ error: "pesan kosong / terlalu panjang" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into exam_messages (school_id, session_id, from_role, from_name, content)
       values (${s.sid}, ${sessionId}, 'staff', ${s.email}, ${body.content})`,
  );
  return c.json({ ok: true });
});

// Daftar sesi yang punya pesan belum ditanggapi dari siswa.
api.get("/api/exams/:id/chats", async (c) => {
  const s = getSess(c);
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select es.id as session_id, st.name as student_name,
              (select content from exam_messages where session_id = es.id order by created_at desc limit 1) as last_msg,
              (select from_role from exam_messages where session_id = es.id order by created_at desc limit 1) as last_from,
              (select created_at from exam_messages where session_id = es.id order by created_at desc limit 1) as last_at,
              (select count(*) from exam_messages where session_id = es.id) as msg_count
       from exam_sessions es
       join students st on st.id = es.student_id
       where es.exam_id = ${examId}
         and exists (select 1 from exam_messages where session_id = es.id)
       order by (select max(created_at) from exam_messages where session_id = es.id) desc`,
  );
  return c.json(rows);
});

// Live monitoring: siapa yang sedang mengerjakan ujian.
api.get("/api/exams/:id/live", async (c) => {
  const s = getSess(c);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select es.id as session_id, es.status, es.started_at, es.last_seen_at,
              es.deadline_at, es.violation_count, case when es.status = 'locked' then es.unlock_code end as unlock_code,
              st.name as student_name, st.username, c.name as class_name,
              (select count(*) from answers a where a.session_id = es.id) as answered,
              coalesce(jsonb_array_length(
                case when jsonb_typeof(es.question_order) = 'object' then es.question_order->'order'
                     when jsonb_typeof(es.question_order) = 'array'  then es.question_order
                     else '[]'::jsonb end), 0) as total
       from exam_sessions es
       join students st on st.id = es.student_id
       left join classes c on c.id = st.class_id
       where es.exam_id = ${id}
       order by es.last_seen_at desc nulls last, es.started_at desc`,
  );
  return c.json(rows);
});

// Export CSV skor peserta satu ujian.
api.get("/api/exams/:id/scores.csv", async (c) => {
  const s = getSess(c);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select st.name as student_name, st.username, c.name as class_name,
              es.status, es.started_at, es.finished_at, es.violation_count,
              sc.auto_score, sc.manual_score, sc.final_score
       from exam_sessions es
       join students st on st.id = es.student_id
       left join classes c on c.id = st.class_id
       left join scores sc on sc.session_id = es.id
       where es.exam_id = ${id}
       order by st.name`,
  );
  const header = ["nama","username","kelas","status","mulai","selesai","pelanggaran","auto","manual","final"];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  type R = { student_name: string; username: string; class_name: string|null; status: string;
    started_at: string|null; finished_at: string|null; violation_count: number;
    auto_score: string|null; manual_score: string|null; final_score: string|null };
  const lines = [header.join(",")];
  for (const r of rows as unknown as R[]) {
    lines.push([r.student_name, r.username, r.class_name, r.status, r.started_at, r.finished_at,
      r.violation_count, r.auto_score, r.manual_score, r.final_score].map(esc).join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="skor-ujian-${id}.csv"`,
    },
  });
});

// Restore backup: upload JSON hasil /api/reports/backup.json, buat sekolah
// baru dengan ID baru. Kode sekolah harus dipilih yang belum dipakai
// (parameter query ?code=xxx). Dibatasi: hanya admin dari sekolah yang
// sudah ada (bukan unlimited onboarding), dan hanya saat APP_ENV!=production
// kecuali pemanggil terdaftar di system_owners.
api.post("/api/reports/restore", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "hanya admin" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  // Owner-check: untuk production, hanya system_owners (daftar email) yang boleh restore.
  if (c.env.APP_ENV === "production") {
    const owner = await sql`select 1 from system_owners where email = ${s.email}`;
    if (owner.length === 0) return c.json({ error: "restore hanya untuk owner sistem di production" }, 403);
  }
  const newCode = c.req.query("code")?.trim().toLowerCase();
  if (!newCode || !/^[a-z0-9-]{3,32}$/.test(newCode)) {
    return c.json({ error: "query ?code=<kode-sekolah-baru> wajib (3–32 huruf kecil/digit/strip)" }, 400);
  }
  const payload = await c.req.json().catch(() => null) as null | Record<string, unknown>;
  if (!payload || typeof payload !== "object" || payload.version !== 1 || !payload.school) {
    return c.json({ error: "format backup tidak valid (version 1 + school required)" }, 400);
  }
  type Row = { id: string } & Record<string, unknown>;
  const data = payload as {
    school: Row & { code: string; name: string; level: string; operator_name: string; operator_phone: string;
      npsn: string | null; color: string; plan: string; student_quota: number; concurrent_quota: number };
    users: Row[]; classes: Row[]; students: Row[]; categories: Row[]; passages: Row[];
    questions: Row[]; question_keys: Array<{ question_id: string } & Record<string, unknown>>;
    exams: Row[];
    exam_classes: Array<{ exam_id: string; class_id: string }>;
    exam_questions: Array<{ exam_id: string; question_id: string; position: number; weight: number }>;
  };

  // Jalankan restore sebagai 'owner' lintas-tenant.
  const result = await withTenant(sql, { schoolId: "", role: "owner" }, async (tx) => {
    // Cek kode belum terpakai (owner bisa lihat semua schools lewat RLS).
    const exists = await tx`select 1 from schools where code = ${newCode}`;
    if (exists.length) throw new Error(`kode '${newCode}' sudah dipakai`);

    // Buat sekolah baru.
    const sch = data.school;
    const newSchool = await tx`insert into schools
      (code, name, level, npsn, operator_name, operator_phone, color, plan,
       student_quota, concurrent_quota, privacy_consent_at)
      values (${newCode}, ${sch.name}, ${sch.level}, ${sch.npsn ?? null},
              ${sch.operator_name}, ${sch.operator_phone}, ${sch.color ?? "biru"}, ${sch.plan ?? "trial"},
              ${sch.student_quota ?? 300}, ${sch.concurrent_quota ?? 300}, now())
      returning id`;
    const newSid = (newSchool[0] as { id: string }).id;

    // Map lama → baru untuk setiap entitas.
    const idMap = new Map<string, string>();
    idMap.set(sch.id, newSid);

    async function remapInsert<T extends Row>(rows: T[], build: (r: T, newId: string) => Promise<void>) {
      for (const r of rows) {
        const nid = crypto.randomUUID();
        idMap.set(r.id, nid);
        await build(r, nid);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyVal = (v: unknown): any => v as any;
    await remapInsert(data.users, async (u, nid) => {
      await tx`insert into users (id, school_id, email, name, role, google_sub, active)
               values (${nid}, ${newSid}, ${anyVal(u.email)}, ${anyVal(u.name) ?? null}, ${anyVal(u.role)}, ${anyVal(u.google_sub) ?? null}, ${anyVal(u.active) ?? true})`;
    });
    await remapInsert(data.classes, async (cl, nid) => {
      await tx`insert into classes (id, school_id, name, grade, year)
               values (${nid}, ${newSid}, ${anyVal(cl.name)}, ${anyVal(cl.grade) ?? null}, ${anyVal(cl.year)})`;
    });
    await remapInsert(data.students, async (st, nid) => {
      const classIdNew = st.class_id ? idMap.get(st.class_id as string) ?? null : null;
      await tx`insert into students (id, school_id, class_id, name, nisn, gender, username, pin_hash, active)
               values (${nid}, ${newSid}, ${classIdNew}, ${anyVal(st.name)}, ${anyVal(st.nisn) ?? null},
                       ${anyVal(st.gender) ?? null}, ${anyVal(st.username)}, ${anyVal(st.pin_hash)}, ${anyVal(st.active) ?? true})`;
    });
    await remapInsert(data.categories, async (cat, nid) => {
      const parentNew = cat.parent_id ? idMap.get(cat.parent_id as string) ?? null : null;
      await tx`insert into categories (id, school_id, name, parent_id)
               values (${nid}, ${newSid}, ${anyVal(cat.name)}, ${parentNew})`;
    });
    await remapInsert(data.passages, async (p, nid) => {
      await tx`insert into passages (id, school_id, title, body)
               values (${nid}, ${newSid}, ${anyVal(p.title) ?? null}, ${anyVal(p.body)})`;
    });
    await remapInsert(data.questions, async (q, nid) => {
      const authorIdNew = q.author_id ? idMap.get(q.author_id as string) ?? null : null;
      const catIdNew = q.category_id ? idMap.get(q.category_id as string) ?? null : null;
      const passIdNew = q.passage_id ? idMap.get(q.passage_id as string) ?? null : null;
      await tx`insert into questions (id, school_id, author_id, category_id, passage_id,
                                      type, content, points)
               values (${nid}, ${newSid}, ${authorIdNew}, ${catIdNew}, ${passIdNew},
                       ${anyVal(q.type)}, ${anyVal(q.content)}, ${anyVal(q.points)})`;
    });
    for (const k of data.question_keys) {
      const qidNew = idMap.get(k.question_id);
      if (!qidNew) continue;
      await tx`insert into question_keys (question_id, school_id, answer_key, rubric)
               values (${qidNew}, ${newSid}, ${anyVal(k.answer_key)}, ${anyVal(k.rubric) ?? null})`;
    }
    await remapInsert(data.exams, async (ex, nid) => {
      const creatorNew = ex.creator_id ? idMap.get(ex.creator_id as string) ?? null : null;
      await tx`insert into exams (id, school_id, creator_id, title, kind, duration_minutes,
                                  shuffle_questions, shuffle_options, anticheat_level,
                                  lock_after_violations, token_hash, starts_at, ends_at, status,
                                  questions_per_session)
               values (${nid}, ${newSid}, ${creatorNew}, ${anyVal(ex.title)}, ${anyVal(ex.kind)}, ${anyVal(ex.duration_minutes)},
                       ${anyVal(ex.shuffle_questions) ?? false}, ${anyVal(ex.shuffle_options) ?? false},
                       ${anyVal(ex.anticheat_level) ?? "log"}, ${anyVal(ex.lock_after_violations) ?? null},
                       ${anyVal(ex.token_hash) ?? null}, ${anyVal(ex.starts_at) ?? null}, ${anyVal(ex.ends_at) ?? null},
                       'draft', ${anyVal(ex.questions_per_session) ?? 0})`;
    });
    for (const ec of data.exam_classes) {
      const ex = idMap.get(ec.exam_id), cl = idMap.get(ec.class_id);
      if (ex && cl) await tx`insert into exam_classes (exam_id, class_id, school_id)
                              values (${ex}, ${cl}, ${newSid})`;
    }
    for (const eq of data.exam_questions) {
      const ex = idMap.get(eq.exam_id), q = idMap.get(eq.question_id);
      if (ex && q) await tx`insert into exam_questions (exam_id, question_id, school_id, position, weight)
                             values (${ex}, ${q}, ${newSid}, ${eq.position}, ${eq.weight})`;
    }

    return {
      ok: true, new_school_id: newSid, new_code: newCode,
      counts: {
        users: data.users.length, classes: data.classes.length, students: data.students.length,
        categories: data.categories.length, passages: data.passages.length,
        questions: data.questions.length, exams: data.exams.length,
      },
    };
  }).catch((e) => ({ error: (e as Error).message }));
  if ("error" in result) return c.json(result, 400);
  return c.json(result);
});

// Backup lengkap konfigurasi sekolah ke JSON (tanpa data operasional:
// sesi, jawaban, pelanggaran, skor — hanya struktur bank soal + kelas +
// siswa untuk pindah lingkungan atau arsip).
api.get("/api/reports/backup.json", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "hanya admin" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const data = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const [school, users, classes, students, categories, passages, questions, keys, exams, examClasses, examQuestions] = await Promise.all([
      tx`select id, code, name, level, npsn, logo_key, color, operator_name, operator_phone,
                plan, student_quota, concurrent_quota, active from schools where id = ${s.sid}`,
      tx`select id, email, name, role, google_sub, active from users`,
      tx`select id, name, grade, year from classes`,
      tx`select id, class_id, name, nisn, gender, username, pin_hash, active from students`,
      tx`select id, name, parent_id from categories`,
      tx`select id, title, body from passages`,
      tx`select id, author_id, category_id, passage_id, type, content, points from questions`,
      tx`select question_id, answer_key, rubric from question_keys`,
      tx`select id, creator_id, title, kind, duration_minutes, shuffle_questions, shuffle_options,
                anticheat_level, lock_after_violations, token_hash, starts_at, ends_at, status,
                questions_per_session from exams`,
      tx`select exam_id, class_id from exam_classes`,
      tx`select exam_id, question_id, position, weight from exam_questions`,
    ]);
    return {
      version: 1, exported_at: new Date().toISOString(),
      school: school[0], users, classes, students, categories, passages, questions,
      question_keys: keys, exams, exam_classes: examClasses, exam_questions: examQuestions,
    };
  });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="backup-${(data.school as { code: string }).code}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});

// Export CSV skor seluruh sekolah (semua ujian × siswa). Berguna untuk
// rekap akhir semester. Query dibungkus withTenant → RLS tetap aktif.
api.get("/api/reports/scores.csv", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select e.title, e.kind, c.name as class_name,
              st.name as student_name, st.username,
              es.status, es.violation_count,
              es.started_at, es.finished_at,
              sc.auto_score, sc.manual_score, sc.final_score
       from exam_sessions es
       join exams    e  on e.id  = es.exam_id
       join students st on st.id = es.student_id
       left join classes c on c.id = st.class_id
       left join scores  sc on sc.session_id = es.id
       order by e.created_at desc, c.name, st.name`,
  );
  const header = ["ujian","jenis","kelas","nama","username","status","pelanggaran",
    "mulai","selesai","auto","manual","final"];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  type R = { title: string; kind: string; class_name: string|null;
    student_name: string; username: string; status: string; violation_count: number;
    started_at: string|null; finished_at: string|null;
    auto_score: string|null; manual_score: string|null; final_score: string|null };
  const lines = [header.join(",")];
  for (const r of rows as unknown as R[]) {
    lines.push([r.title, r.kind, r.class_name, r.student_name, r.username,
      r.status, r.violation_count, r.started_at, r.finished_at,
      r.auto_score, r.manual_score, r.final_score].map(esc).join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rekap-skor-sekolah.csv"`,
    },
  });
});

// Distractor analysis: untuk soal pg, berapa % siswa memilih tiap opsi?
// Berguna untuk cari distractor efektif dan opsi yang bikin bingung.
api.get("/api/exams/:id/distractors", async (c) => {
  const s = getSess(c);
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    distractorRows(tx, examId),
  );
  return c.json(rows);
});

// Statistik butir soal: p-value (proporsi benar) + daya pembeda (D).
// D = p(kelompok atas 27%) - p(kelompok bawah 27%).
// Tafsir D: >0.4 sangat baik, 0.3-0.4 baik, 0.2-0.3 cukup, <0.2 jelek.
// Tafsir p-value: 0.3-0.7 ideal (tidak terlalu mudah/sulit).
api.get("/api/exams/:id/items", async (c) => {
  const s = getSess(c);
  const examId = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    itemRows(tx, examId),
  );
  return c.json(rows);
});

// Ringkasan rata-rata per kelas untuk sebuah ujian.
api.get("/api/exams/:id/summary", async (c) => {
  const s = getSess(c);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select coalesce(c.name, '(tanpa kelas)') as class_name,
              count(*) as peserta,
              count(sc.final_score) as nilai_tersedia,
              round(avg(sc.final_score), 2) as rata_rata,
              min(sc.final_score) as terendah,
              max(sc.final_score) as tertinggi
       from exam_sessions es
       join students st on st.id = es.student_id
       left join classes c on c.id = st.class_id
       left join scores sc on sc.session_id = es.id
       where es.exam_id = ${id}
       group by c.name order by c.name`,
  );
  return c.json(rows);
});

api.post("/api/exams/:id/questions", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | { question_ids: string[] };
  if (!body || !Array.isArray(body.question_ids)) return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    await tx`delete from exam_questions where exam_id = ${id}`;
    if (body.question_ids.length) {
      const rows = body.question_ids.map((qid, i) => ({ exam_id: id, question_id: qid, school_id: s.sid, position: i + 1 }));
      await tx`insert into exam_questions ${tx(rows, "exam_id", "question_id", "school_id", "position")}`;
    }
  });
  return c.json({ ok: true, count: body.question_ids.length });
});

api.post("/api/exams/:id/classes", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null) as null | { class_ids: string[] };
  if (!body || !Array.isArray(body.class_ids)) return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    await tx`delete from exam_classes where exam_id = ${id}`;
    if (body.class_ids.length) {
      const rows = body.class_ids.map((cid) => ({ exam_id: id, class_id: cid, school_id: s.sid }));
      await tx`insert into exam_classes ${tx(rows, "exam_id", "class_id", "school_id")}`;
    }
  });
  return c.json({ ok: true, count: body.class_ids.length });
});

api.get("/api/exams/:id/scores", async (c) => {
  const s = getSess(c);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select es.id as session_id, st.name as student_name, st.username,
              es.status, es.violation_count, es.started_at, es.finished_at,
              sc.auto_score, sc.manual_score, sc.final_score
       from exam_sessions es
       join students st on st.id = es.student_id
       left join scores sc on sc.session_id = es.id
       where es.exam_id = ${id}
       order by st.name`,
  );
  return c.json(rows);
});

api.delete("/api/students/:id", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`delete from students where id = ${id} returning id`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
