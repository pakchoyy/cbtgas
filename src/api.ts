// REST API staf: kelas & siswa. Semua di-guard sesi staf dan dibungkus withTenant.

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { requireStaff, AuthBindings } from "./auth";
import { hashPin } from "./hash";
import { sendEmail, inviteEmail, pinNotifyEmail } from "./email";
import { audit, actorFromSession } from "./audit";

export const api = new Hono<{ Bindings: AuthBindings & { APP_ENV: string; RESEND_API_KEY?: string; EMAIL_FROM?: string } }>();

api.use("/api/*", async (c, next) => {
  // /api/students sudah ada di index.ts (dengan fallback dev). Semua selain itu wajib sesi.
  if (c.req.path === "/api/students" && c.req.method === "GET") return next();
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!sess) return c.json({ error: "unauthorized" }, 401);
  c.set("sess" as never, sess);
  await next();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getSess = (c: any) => c.get("sess") as import("./session").Session;

// ===== Classes =====

api.get("/api/classes", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select id, name, grade, year from classes order by year desc, grade nulls last, name`,
  );
  return c.json(rows);
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
  if (!body?.name || !body?.username || !body?.pin) return c.json({ error: "missing fields" }, 400);
  if (!/^\d{4,8}$/.test(body.pin)) return c.json({ error: "pin harus 4–8 digit" }, 400);
  try {
    const pin_hash = await hashPin(body.pin);
    const sql = connect(c.env.HYPERDRIVE.connectionString);
    const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
      tx`insert into students (school_id, class_id, name, username, gender, nisn, pin_hash)
         values (${s.sid}, ${body.class_id ?? null}, ${body.name}, ${body.username},
                 ${body.gender ?? null}, ${body.nisn ?? null}, ${pin_hash})
         returning id, name, username`,
    );
    return c.json(r[0], 201);
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
api.post("/api/students/import", async (c) => {
  const s = getSess(c);
  if (s.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const text = await c.req.text();
  const rows = parseCsv(text);
  if (rows.length === 0) return c.json({ error: "csv kosong" }, 400);
  const header = rows[0].map((x) => x.toLowerCase().trim());
  const want = ["name", "username", "class", "gender", "nisn", "pin"];
  const idx: Record<string, number> = {};
  for (const k of want) idx[k] = header.indexOf(k);
  if (idx.name < 0 || idx.username < 0 || idx.pin < 0) {
    return c.json({ error: "header wajib: name, username, pin (plus opsional class, gender, nisn)" }, 400);
  }
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const result = await withTenant(
    sql, { schoolId: s.sid, role: s.role, userId: s.uid },
    async (tx) => {
      const classes = await tx`select id, name from classes`;
      const classMap = new Map<string, string>();
      for (const row of classes as unknown as Array<{ id: string; name: string }>) classMap.set(row.name, row.id);
      const ok: string[] = []; const fail: { row: number; error: string }[] = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]; if (r.length === 1 && r[0] === "") continue;
        const name = r[idx.name]?.trim(); const username = r[idx.username]?.trim();
        const pin = r[idx.pin]?.trim();
        const className = idx.class >= 0 ? r[idx.class]?.trim() : "";
        const gender = idx.gender >= 0 ? r[idx.gender]?.trim().toUpperCase() : "";
        const nisn = idx.nisn >= 0 ? r[idx.nisn]?.trim() : "";
        if (!name || !username || !pin) { fail.push({ row: i + 1, error: "name/username/pin kosong" }); continue; }
        if (!/^\d{4,8}$/.test(pin)) { fail.push({ row: i + 1, error: "pin bukan 4-8 digit" }); continue; }
        if (gender && gender !== "L" && gender !== "P") { fail.push({ row: i + 1, error: "gender harus L/P" }); continue; }
        const classId = className ? classMap.get(className) : null;
        if (className && !classId) { fail.push({ row: i + 1, error: `kelas '${className}' tidak ada` }); continue; }
        try {
          const pin_hash = await hashPin(pin);
          const ins = await tx`insert into students
            (school_id, class_id, name, username, gender, nisn, pin_hash)
            values (${s.sid}, ${classId ?? null}, ${name}, ${username},
                    ${gender || null}, ${nisn || null}, ${pin_hash})
            returning id`;
          ok.push((ins[0] as { id: string }).id);
        } catch (e) {
          fail.push({ row: i + 1, error: (e as Error).message.slice(0, 120) });
        }
      }
      return { ok: ok.length, fail };
    },
  );
  return c.json(result);
});

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
      ? tx`select q.id, q.type, q.content, q.points, q.category_id, k.answer_key, k.rubric
           from questions q left join question_keys k on k.question_id = q.id
           where q.category_id = ${cat}
           order by q.created_at desc limit 500`
      : tx`select q.id, q.type, q.content, q.points, q.category_id, k.answer_key, k.rubric
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
api.post("/api/questions", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | Record<string, unknown>;
  if (!body) return c.json({ error: "bad body" }, 400);
  const type = String(body.type || "pg");
  const text = String(body.text || "").trim();
  const points = typeof body.points === "number" ? body.points : 1;
  const categoryId = body.category_id ? String(body.category_id) : null;
  const passageId = body.passage_id ? String(body.passage_id) : null;
  // Gambar opsional, disimpan sebagai data URI di content.image. Cap 400KB
  // supaya payload DB tetap wajar (jsonb) dan push ke Hyperdrive tidak molor.
  const image = body.image ? String(body.image) : null;
  if (!text && !image) return c.json({ error: "teks soal kosong" }, 400);
  if (image) {
    if (!image.startsWith("data:image/")) return c.json({ error: "image harus data URI gambar" }, 400);
    if (image.length > 400_000) return c.json({ error: "ukuran gambar > 400KB" }, 413);
  }

  let content: Record<string, unknown>; let answer_key: unknown; let rubric: string | null = null;
  if (type === "pg") {
    const options = Array.isArray(body.options) ? (body.options as string[]) : [];
    const correct = Number(body.correct);
    if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      return c.json({ error: "data pilihan ganda tidak valid" }, 400);
    }
    content = { text, options }; answer_key = { index: correct };
  } else if (type === "benar_salah") {
    if (typeof body.correct !== "boolean") return c.json({ error: "'correct' harus boolean" }, 400);
    content = { text, options: ["Benar", "Salah"] };
    answer_key = { index: body.correct ? 0 : 1 };
  } else if (type === "isian") {
    const accepted = Array.isArray(body.accepted) ? (body.accepted as string[])
      .map((x) => x.trim()).filter(Boolean) : [];
    if (accepted.length === 0) return c.json({ error: "jawaban yang diterima kosong" }, 400);
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
      return c.json({ error: "pgk_centang: butuh ≥2 opsi dan minimal 1 jawaban benar" }, 400);
    }
    content = { text, options };
    answer_key = { correct: Array.from(new Set(correctIdx)).sort((a, b) => a - b) };
  } else if (type === "menjodohkan") {
    // Matching. left & right: string[]. pairs: array of [leftIdx, rightIdx] canonical.
    const left = Array.isArray(body.left) ? (body.left as string[]).filter(Boolean) : [];
    const right = Array.isArray(body.right) ? (body.right as string[]).filter(Boolean) : [];
    if (left.length < 2 || right.length < left.length) {
      return c.json({ error: "menjodohkan: butuh minimal 2 pasangan dan right ≥ left" }, 400);
    }
    // Default canonical pairing: left[i] ↔ right[i]
    content = { text, left, right };
    answer_key = { pairs: left.map((_, i) => [i, i] as [number, number]) };
  } else {
    return c.json({ error: `tipe '${type}' belum didukung` }, 400);
  }
  if (image) content.image = image;

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

// Buka kembali sesi yang di-locked oleh anti-cheat. Reset violation_count
// supaya siswa tidak langsung terkunci lagi di event berikutnya.
api.post("/api/sessions/:sid/unlock", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const sessionId = c.req.param("sid");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const u = await tx`update exam_sessions set status = 'active', violation_count = 0,
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
    // Hitung ulang skor sesi.
    const sess = await tx`select exam_id, student_id from exam_sessions where id = ${sessionId}`;
    if (sess.length === 0) throw new Error("sesi tidak ditemukan");
    const examId = (sess[0] as { exam_id: string }).exam_id;
    const studentId = (sess[0] as { student_id: string }).student_id;
    const g = await tx`
      select coalesce(sum(
        case q.type
          when 'pg'          then case when (k.answer_key->>'index')::int = (a.answer->>'index')::int then q.points else 0 end
          when 'benar_salah' then case when (k.answer_key->>'index')::int = (a.answer->>'index')::int then q.points else 0 end
          when 'isian'       then case when exists(
                                    select 1 from jsonb_array_elements_text(k.answer_key->'accepted') x
                                    where lower(trim(x.value)) = lower(trim(a.answer->>'text'))
                                  ) then q.points else 0 end
          when 'pgk_centang' then case when (
                                    select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(k.answer_key->'correct') x
                                 ) = (
                                    select coalesce(array_agg(x::int order by x), '{}') from jsonb_array_elements_text(a.answer->'selected') x
                                 ) then q.points else 0 end
          when 'menjodohkan' then case when a.answer->'pairs' = k.answer_key->'pairs' then q.points else 0 end
          when 'uraian'      then coalesce((a.answer->>'manual_score')::numeric, 0)
          else 0 end), 0) as got,
             coalesce(sum(q.points), 0) as total
        from jsonb_array_elements_text(coalesce(
          (select case
                    when jsonb_typeof(question_order) = 'object' then question_order->'order'
                    when jsonb_typeof(question_order) = 'array'  then question_order
                    else null end
           from exam_sessions where id = ${sessionId}),
          (select to_jsonb(array_agg(question_id)) from exam_questions where exam_id = ${examId})
        )) as qid
        join questions q on q.id = qid.value::uuid
        left join question_keys k on k.question_id = q.id
        left join answers a on a.session_id = ${sessionId} and a.question_id = q.id`;
    const sc = g[0] as { got: string; total: string };
    const total = parseFloat(sc.total); const got = parseFloat(sc.got);
    const final_score = total > 0 ? (got / total) * 100 : 0;
    await tx`insert into scores (session_id, school_id, exam_id, student_id, auto_score, manual_score, final_score, approved_by, approved_at)
             values (${sessionId}, ${s.sid}, ${examId}, ${studentId}, null, ${got}, ${final_score}, ${s.uid}, now())
             on conflict (session_id) do update set manual_score = excluded.manual_score,
                final_score = excluded.final_score, approved_by = excluded.approved_by, approved_at = excluded.approved_at`;
    return { ok: true, final: final_score };
  });
  return c.json(out);
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
    title: string; kind: "harian"|"pts_pas"|"sumatif"|"tryout"; duration_minutes: number;
    starts_at?: string | null; ends_at?: string | null;
    shuffle_questions?: boolean; shuffle_options?: boolean;
    anticheat_level?: "log"|"warn"|"lock"; lock_after_violations?: number | null;
    questions_per_session?: number;
  };
  if (!body?.title || !body.kind || !body.duration_minutes) return c.json({ error: "data ujian kurang" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into exams (school_id, creator_id, title, kind, duration_minutes,
         starts_at, ends_at, shuffle_questions, shuffle_options, anticheat_level, lock_after_violations,
         questions_per_session)
       values (${s.sid}, ${s.uid}, ${body.title}, ${body.kind}, ${body.duration_minutes},
         ${body.starts_at ?? null}, ${body.ends_at ?? null},
         ${body.shuffle_questions ?? false}, ${body.shuffle_options ?? false},
         ${body.anticheat_level ?? "log"}, ${body.lock_after_violations ?? null},
         ${body.questions_per_session ?? 0})
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
    const byCat = await tx`
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
      group by cat.name order by cat.name`;
    const violations = await tx`
      select count(*)::int as n, kind
      from violations v join exam_sessions es on es.id = v.session_id
      where es.student_id = ${id} group by kind order by kind`;
    return { info: info[0], timeline, byCat, violations };
  });
  if (!data) return c.json({ error: "siswa tidak ditemukan" }, 404);
  return c.json(data);
});

// Live monitoring: siapa yang sedang mengerjakan ujian.
api.get("/api/exams/:id/live", async (c) => {
  const s = getSess(c);
  const id = c.req.param("id");
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select es.id as session_id, es.status, es.started_at, es.last_seen_at,
              es.deadline_at, es.violation_count,
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
    for (let i = 0; i < body.question_ids.length; i++) {
      await tx`insert into exam_questions (exam_id, question_id, school_id, position)
               values (${id}, ${body.question_ids[i]}, ${s.sid}, ${i + 1})`;
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
    for (const cid of body.class_ids) {
      await tx`insert into exam_classes (exam_id, class_id, school_id) values (${id}, ${cid}, ${s.sid})`;
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
