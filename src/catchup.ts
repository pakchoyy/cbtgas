// Transisi jadwal ujian per sekolah, dijalankan saat ada yang membuka aplikasi
// (bukan cron tiap menit), supaya database Neon bisa tidur saat sepi.
//   draft/scheduled → open   saat starts_at lewat
//   open/...        → closed saat ends_at lewat
//   sesi aktif yang deadline-nya lewat 10 menit → expired + dinilai (tenggang untuk siswa yang sempat offline)
import { isD1 } from "./d1";
import type postgres from "postgres";
import { withTenant } from "./db";
import { finalizeSession } from "./scoring";

const lastRun = new Map<string, number>();

export async function catchUp(sql: postgres.Sql, schoolId: string): Promise<void> {
  if (!schoolId) return;
  const now = Date.now();
  if ((lastRun.get(schoolId) ?? 0) > now - 20_000) return; // cukup sekali per 20 detik per isolate
  lastRun.set(schoolId, now);
  if (lastRun.size > 5000) lastRun.clear();
  await withTenant(sql, { schoolId: "", role: "owner" }, async (tx) => {
    await tx`update exams set status = 'open'
      where school_id = ${schoolId} and status in ('draft','scheduled')
        and starts_at is not null and starts_at <= now() and (ends_at is null or ends_at > now())`;
    await tx`update exams set status = 'closed'
      where school_id = ${schoolId} and status in ('open','draft','scheduled')
        and ends_at is not null and ends_at <= now()`;
    const expired = await tx`select id from exam_sessions
      where school_id = ${schoolId} and status = 'active' and deadline_at <= now() - interval '10 minutes' and paused_at is null
      limit ${isD1(tx) ? 5 : 1000000}`; // D1: batasi per permintaan (anggaran query); sisanya diproses catchUp berikutnya
    for (const r of expired as unknown as Array<{ id: string }>) await finalizeSession(tx, r.id, "expired");
  }).catch((e) => console.log("catchUp", (e as Error).message));
}
