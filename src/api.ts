// REST API staf: kelas & siswa. Semua di-guard sesi staf dan dibungkus withTenant.

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { requireStaff, AuthBindings } from "./auth";
import { hashPin } from "./hash";

export const api = new Hono<{ Bindings: AuthBindings & { APP_ENV: string } }>();

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
         pin_hash = coalesce(${pin_hash}, pin_hash)
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

// ===== Bank soal (hanya tipe 'pg' untuk versi pertama) =====

api.get("/api/questions", async (c) => {
  const s = getSess(c);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select q.id, q.content, q.points, k.answer_key
       from questions q left join question_keys k on k.question_id = q.id
       where q.type = 'pg'
       order by q.created_at desc limit 500`,
  );
  return c.json(rows);
});

api.post("/api/questions", async (c) => {
  const s = getSess(c);
  if (s.role === "proctor") return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => null) as null | {
    text: string; options: string[]; correct: number; points?: number;
  };
  if (!body?.text || !Array.isArray(body.options) || body.options.length < 2
    || typeof body.correct !== "number" || body.correct < 0 || body.correct >= body.options.length) {
    return c.json({ error: "data soal tidak valid" }, 400);
  }
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const q = await tx`insert into questions (school_id, author_id, type, content, points)
      values (${s.sid}, ${s.uid}, 'pg',
              ${{ text: body.text, options: body.options } as unknown as string},
              ${body.points ?? 1})
      returning id`;
    const qid = (q[0] as { id: string }).id;
    await tx`insert into question_keys (question_id, school_id, answer_key)
      values (${qid}, ${s.sid}, ${{ index: body.correct } as unknown as string})`;
    return { id: qid };
  });
  return c.json(r, 201);
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
  };
  if (!body?.title || !body.kind || !body.duration_minutes) return c.json({ error: "data ujian kurang" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into exams (school_id, creator_id, title, kind, duration_minutes)
       values (${s.sid}, ${s.uid}, ${body.title}, ${body.kind}, ${body.duration_minutes})
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
  };
  if (!body) return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update exams set
         title = coalesce(${body.title ?? null}, title),
         duration_minutes = coalesce(${body.duration_minutes ?? null}, duration_minutes),
         status = coalesce(${body.status ?? null}, status)
       where id = ${id} returning id, status`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(r[0]);
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
    tx`select st.name as student_name, st.username, es.status, es.started_at, es.finished_at,
              sc.auto_score, sc.final_score
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
