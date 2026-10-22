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
    tx`select q.id, q.type, q.content, q.points, k.answer_key, k.rubric
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
  if (!text) return c.json({ error: "teks soal kosong" }, 400);

  let content: unknown; let answer_key: unknown; let rubric: string | null = null;
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
  } else {
    return c.json({ error: `tipe '${type}' belum didukung` }, 400);
  }

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, async (tx) => {
    const q = await tx`insert into questions (school_id, author_id, type, content, points)
      values (${s.sid}, ${s.uid}, ${type},
              ${content as unknown as string}, ${points}) returning id`;
    const qid = (q[0] as { id: string }).id;
    await tx`insert into question_keys (question_id, school_id, answer_key, rubric)
      values (${qid}, ${s.sid}, ${answer_key as unknown as string}, ${rubric})`;
    return { id: qid, type };
  });
  return c.json(r, 201);
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
          when 'uraian'      then coalesce((a.answer->>'manual_score')::numeric, 0)
          else 0 end), 0) as got,
             coalesce(sum(q.points), 0) as total
        from exam_questions eq
        join questions q on q.id = eq.question_id
        left join question_keys k on k.question_id = q.id
        left join answers a on a.session_id = ${sessionId} and a.question_id = q.id
        where eq.exam_id = ${examId}`;
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
  };
  if (!body?.title || !body.kind || !body.duration_minutes) return c.json({ error: "data ujian kurang" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`insert into exams (school_id, creator_id, title, kind, duration_minutes,
         starts_at, ends_at, shuffle_questions, shuffle_options, anticheat_level, lock_after_violations)
       values (${s.sid}, ${s.uid}, ${body.title}, ${body.kind}, ${body.duration_minutes},
         ${body.starts_at ?? null}, ${body.ends_at ?? null},
         ${body.shuffle_questions ?? false}, ${body.shuffle_options ?? false},
         ${body.anticheat_level ?? "log"}, ${body.lock_after_violations ?? null})
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
  };
  if (!body) return c.json({ error: "bad body" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`update exams set
         title = coalesce(${body.title ?? null}, title),
         duration_minutes = coalesce(${body.duration_minutes ?? null}, duration_minutes),
         status = coalesce(${body.status ?? null}, status),
         starts_at = case when ${body.starts_at !== undefined} then ${body.starts_at ?? null} else starts_at end,
         ends_at = case when ${body.ends_at !== undefined} then ${body.ends_at ?? null} else ends_at end,
         shuffle_questions = coalesce(${body.shuffle_questions ?? null}, shuffle_questions),
         shuffle_options = coalesce(${body.shuffle_options ?? null}, shuffle_options),
         anticheat_level = coalesce(${body.anticheat_level ?? null}, anticheat_level),
         lock_after_violations = case when ${body.lock_after_violations !== undefined}
            then ${body.lock_after_violations ?? null} else lock_after_violations end
       where id = ${id} returning id, status`,
  );
  if (r.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(r[0]);
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
