import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeD1Db } from "./fake-d1.ts";
import { connectD1, withTenantD1 } from "../src/d1.ts";
import { isoTs, atomic } from "../src/dbfn.ts";
import { finalizeSession } from "../src/scoring.ts";

const S = "aaaaaaaa-0000-4000-8000-000000000001";

test("boolean: semua kolom boolean dikenal kembali sebagai true/false (termasuk lewat batch)", async () => {
  const f = fakeD1Db();
  const open = connectD1(f.d1).unscoped();
  await open`insert into schools (id,code,name,level,operator_name,operator_phone) values (${S},'sek-a','A','SMA','o','1')`;
  await open`insert into users (school_id,email,role) values (${S},'a@b.id','admin')`;
  await open`insert into exams (id,school_id,title,kind,duration_minutes,use_token) values ('E',${S},'t','k',10,${true})`;
  const [u] = await open`select id, active from users`;
  assert.equal(u.active, true);
  const [e] = await open`select shuffle_questions, shuffle_options, use_token, show_score from exams`;
  assert.deepEqual({ ...e }, { shuffle_questions: false, shuffle_options: false, use_token: true, show_score: true });
  const [r] = await atomic(open, [(q) => q`select active from users`]);
  assert.equal(r[0].active, true);
  // Kasus yang tadinya salah: nilai ditulis ke atribut HTML lalu dibandingkan dengan 'true' di klien.
  assert.equal(`data-on="${u.active}"`, 'data-on="true"');
  assert.equal(`${u.active}` !== "true", false); // tombol "Nonaktifkan" kini benar-benar menonaktifkan
  const [l] = await open`select logo_key is not null as has_logo, exists(select 1 from users) as has_essay from schools`;
  assert.deepEqual([l.has_logo, l.has_essay], [false, true]);
  // angka biasa bernama lain tidak ikut diubah
  const [n] = await open`select 1 as satu, 0 as nol`;
  assert.deepEqual([n.satu, n.nol], [1, 0]);
});

test("isoTs: format apa pun jadi ISO UTC; kosong jadi null; sampah ditolak", () => {
  assert.equal(isoTs("2026-11-17T09:00:00+07:00"), "2026-11-17T02:00:00.000Z");
  assert.equal(isoTs("2026-11-17T09:00:00.000Z"), "2026-11-17T09:00:00.000Z");
  assert.equal(isoTs(new Date("2026-01-02T03:04:05Z")), "2026-01-02T03:04:05.000Z");
  assert.equal(isoTs(null), null); assert.equal(isoTs(undefined), null); assert.equal(isoTs(""), null);
  assert.throws(() => isoTs("besok pagi"), /waktu tidak valid/i);
});

test("jadwal ujian: waktu bukan-UTC yang dinormalkan tetap berurutan benar terhadap now()", async () => {
  const f = fakeD1Db();
  const open = connectD1(f.d1).unscoped();
  await open`insert into schools (id,code,name,level,operator_name,operator_phone) values (${S},'sek-a','A','SMA','o','1')`;
  // mulai 2 jam lalu di zona +07:00 (terlihat "lebih besar" secara leksikal bila tak dinormalkan), berakhir 1 jam lagi
  const start = new Date(Date.now() - 2 * 3600e3), end = new Date(Date.now() + 3600e3);
  const wib = (d: Date) => new Date(d.getTime() + 7 * 3600e3).toISOString().replace("Z", "+07:00");
  await open`insert into exams (id,school_id,title,kind,duration_minutes,starts_at,ends_at,status) values ('E',${S},'t','k',10,${isoTs(wib(start))},${isoTs(wib(end))},'scheduled')`;
  const now = await open`select id from exams where starts_at <= now() and (ends_at is null or ends_at > now())`;
  assert.equal(now.length, 1);
});

test("skor dibulatkan 2 desimal seperti numeric(7,2) di Neon (66.67, bukan 66.66666666666667)", async () => {
  const f = fakeD1Db();
  const open = connectD1(f.d1).unscoped();
  await open`insert into schools (id,code,name,level,operator_name,operator_phone) values (${S},'sek-a','A','SMA','o','1')`;
  await open`insert into classes (id,school_id,name,year) values ('cl',${S},'X','2026')`;
  await open`insert into students (id,school_id,class_id,name,username,pin_hash) values ('st',${S},'cl','N','u','h')`;
  await open`insert into exams (id,school_id,title,kind,duration_minutes) values ('E',${S},'t','k',30)`;
  for (const id of ["q1", "q2", "q3"]) {
    await open`insert into questions (id,school_id,type,content,points) values (${id},${S},'pg','{}',1)`;
    await open`insert into question_keys (question_id,school_id,answer_key) values (${id},${S},${{ index: 0 }})`;
    await open`insert into exam_questions (exam_id,question_id,school_id,position) values ('E',${id},${S},1)`;
  }
  await open`insert into exam_sessions (id,school_id,exam_id,student_id,deadline_at) values ('ses',${S},'E','st',now())`;
  for (const [id, idx] of [["q1", 0], ["q2", 0], ["q3", 1]] as const) {
    await open`insert into answers (session_id,question_id,school_id,answer) values ('ses',${id},${S},${{ index: idx }})`;
  }
  const r = await withTenantD1(connectD1(f.d1), { schoolId: S, role: "student", userId: "st" }, (tx) => finalizeSession(tx, "ses", "submitted"));
  assert.equal(r.score, 66.67);
  assert.equal((await open`select final_score, auto_score from scores`)[0].final_score, 66.67);
});
