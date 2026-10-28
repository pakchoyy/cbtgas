// Siklus hidup sesi ujian yang dipakai bersama oleh portal siswa, mode lab,
// cron, kumpul paksa, dan penilaian manual. Satu tempat = satu aturan.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

// Hitung nilai lewat fungsi database score_session(), tulis ke scores.
// status: 'submitted' (siswa/guru menutup) atau 'expired' (waktu habis).
export async function finalizeSession(
  tx: Tx, sessionId: string, status: "submitted" | "expired",
): Promise<{ score: number; needs_manual: boolean }> {
  const ses = await tx`select exam_id, student_id, school_id from exam_sessions where id = ${sessionId}`;
  if (ses.length === 0) throw new Error("sesi tidak ditemukan");
  const { exam_id, student_id, school_id } = ses[0] as { exam_id: string; student_id: string; school_id: string };
  await tx`update exam_sessions set status = ${status}, finished_at = coalesce(finished_at, now())
           where id = ${sessionId} and status in ('active', 'locked')`;
  return writeScore(tx, sessionId, exam_id, student_id, school_id);
}

// Hitung ulang dan simpan nilai (dipakai juga setelah guru menilai uraian).
export async function writeScore(
  tx: Tx, sessionId: string, examId: string, studentId: string, schoolId: string,
  approvedBy: string | null = null,
): Promise<{ score: number; needs_manual: boolean }> {
  const r = await tx`select got, total, manual_pending from score_session(${sessionId})`;
  const { got, total, manual_pending } = r[0] as { got: string; total: string; manual_pending: string };
  const t = parseFloat(total);
  const score = t > 0 ? (parseFloat(got) / t) * 100 : 0;
  await tx`insert into scores (session_id, school_id, exam_id, student_id, auto_score, final_score, approved_by, approved_at)
           values (${sessionId}, ${schoolId}, ${examId}, ${studentId}, ${score}, ${score},
                   ${approvedBy}, ${approvedBy ? new Date().toISOString() : null})
           on conflict (session_id) do update set
             auto_score = excluded.auto_score, final_score = excluded.final_score,
             approved_by = coalesce(excluded.approved_by, scores.approved_by),
             approved_at = coalesce(excluded.approved_at, scores.approved_at)`;
  return { score, needs_manual: parseFloat(manual_pending) > 0 };
}

const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Buat sesi baru untuk satu siswa. Menegakkan urutan rangkaian, memilih soal
// (pool + acak), mengacak opsi, menghitung tenggat, dan menyiapkan angka acak
// soal dinamis. Pemanggil yang memastikan ujian dibuka untuk kelas siswa.
export async function createSession(
  tx: Tx, schoolId: string, examId: string, studentId: string,
): Promise<string> {
  const ex = await tx`select duration_minutes, ends_at, shuffle_questions, shuffle_options,
                             questions_per_session, group_id, group_position
                      from exams where id = ${examId}`;
  if (ex.length === 0) throw new Error("ujian tidak ditemukan");
  const e = ex[0] as { duration_minutes: number; ends_at: string | null; shuffle_questions: boolean;
    shuffle_options: boolean; questions_per_session: number; group_id: string | null; group_position: number | null };

  if (e.group_id && e.group_position != null) {
    const pending = await tx`
      select 1 from exams x
      join exam_groups g on g.id = x.group_id and g.strict_order
      where x.group_id = ${e.group_id} and x.group_position < ${e.group_position}
        and not exists (select 1 from exam_sessions s where s.exam_id = x.id
                        and s.student_id = ${studentId} and s.status = 'submitted')`;
    if (pending.length) throw new Error("Selesaikan ujian sebelumnya di rangkaian ini terlebih dahulu.");
  }

  const qs = await tx`select question_id from exam_questions where exam_id = ${examId} order by position`;
  let order = (qs as Array<{ question_id: string }>).map((x) => x.question_id);
  if (order.length === 0) throw new Error("ujian belum punya soal");
  if (e.questions_per_session > 0 && e.questions_per_session < order.length) order = shuffle(order).slice(0, e.questions_per_session);
  if (e.shuffle_questions) order = shuffle(order);

  const qrows = await tx`select id, type, content from questions where id in ${tx(order)}`;
  const perms: Record<string, number[]> = {};
  const dyn: Array<{ id: string; a: number; b: number }> = [];
  for (const q of qrows as Array<{ id: string; type: string; content: Record<string, unknown> }>) {
    const opts = q.content.options as string[] | undefined;
    if (e.shuffle_options && q.type === "pg" && Array.isArray(opts) && opts.length > 1) perms[q.id] = shuffle(opts.map((_, k) => k));
    if (q.type === "dinamis_hitung") {
      const ra = q.content.a as { min: number; max: number }, rb = q.content.b as { min: number; max: number };
      dyn.push({ id: q.id,
        a: ra.min + Math.floor(Math.random() * (ra.max - ra.min + 1)),
        b: rb.min + Math.floor(Math.random() * (rb.max - rb.min + 1)) });
    }
  }

  const end = Math.min(Date.now() + e.duration_minutes * 60_000,
    e.ends_at ? new Date(e.ends_at).getTime() : Number.POSITIVE_INFINITY);
  const ins = await tx`insert into exam_sessions (school_id, exam_id, student_id, deadline_at, question_order)
    values (${schoolId}, ${examId}, ${studentId}, ${new Date(end).toISOString()}, ${{ order, perms } as unknown as string})
    returning id`;
  const sessionId = (ins[0] as { id: string }).id;
  for (const d of dyn) {
    await tx`insert into answers (session_id, question_id, school_id, answer, updated_at)
             values (${sessionId}, ${d.id}, ${schoolId}, ${{ vars: { a: d.a, b: d.b } } as unknown as string}, now())
             on conflict (session_id, question_id) do nothing`;
  }
  return sessionId;
}
