import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { auth, requireStaff, AuthBindings } from "./auth";
import { pages } from "./pages";
import { api } from "./api";
import { student } from "./student";

type Bindings = AuthBindings & { APP_ENV: string };
const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));

// Trigger manual untuk cron handler (sinkron dengan scheduled()).
// Dev-only — di production endpoint ini kembali 404. Berguna untuk
// menjalankan transisi status tanpa menunggu cron.
app.post("/__cron/run", async (c) => {
  if (c.env.APP_ENV === "production") return c.notFound();
  const result = await runScheduledJobs(c.env);
  return c.json({ ok: true, ...result });
});

// PWA: manifest + service worker + ikon SVG inline (vektor sederhana).
app.get("/manifest.webmanifest", (c) => c.json({
  name: "cbtgas · CBT Sekolah",
  short_name: "cbtgas",
  start_url: "/",
  display: "standalone",
  background_color: "#fafafa",
  theme_color: "#2563eb",
  description: "Platform CBT untuk SD-SMA.",
  icons: [
    { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
    { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
  ],
}));

// Dua ikon dari SVG yang sama (vektor skalabel; browser pakai sizes atribut).
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="36" fill="#2563eb"/>
  <text x="96" y="130" font-family="system-ui,sans-serif" font-size="110" font-weight="700" fill="#fff" text-anchor="middle">C</text>
</svg>`;
app.get("/icon-192.svg", (c) => new Response(ICON_SVG, { headers: { "Content-Type": "image/svg+xml" } }));
app.get("/icon-512.svg", (c) => new Response(ICON_SVG, { headers: { "Content-Type": "image/svg+xml" } }));

// Service worker: hanya cache shell (landing + login siswa). Semua request
// data (/api/*, /s/take/*) selalu network. Dibatasi runtime cache ringan
// untuk GET /s/login & / supaya PWA bisa buka saat offline sampai login.
app.get("/sw.js", (c) => {
  const sw = `const CACHE = 'cbtgas-shell-v2';
const SHELL = ['/', '/s/login', '/manifest.webmanifest', '/icon-192.svg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Jangan cache route data/sensitif. Lewat network murni.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/s/history')) return;
  // /s/take/:sid di-cache saat berhasil (network-first) agar bisa dibuka
  // kembali offline sampai siswa klik tombol navigasi.
  const isTake = url.pathname.startsWith('/s/take/');
  const isShell = SHELL.includes(url.pathname);
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (isShell || isTake) {
        const cache = await caches.open(CACHE);
        cache.put(req, r.clone());
      }
      return r;
    } catch (_) {
      const cached = await caches.match(req);
      return cached || new Response('Offline', { status: 503 });
    }
  })());
});`;
  return new Response(sw, {
    headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" },
  });
});

app.route("/", auth);
app.route("/", api);
app.route("/", student);
app.route("/", pages);

// Siswa milik sekolah yang sedang login (role staf).
app.get("/api/students", async (c) => {
  // Fallback: header x-school-id masih diterima selama APP_ENV=dev untuk testing demo.
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET);
  const devSchool = c.env.APP_ENV !== "production" ? c.req.header("x-school-id") : null;
  const schoolId = sess?.sid ?? devSchool;
  const role = sess?.role ?? "teacher";
  const userId = sess?.uid;
  if (!schoolId) return c.json({ error: "unauthorized" }, 401);

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId, role, userId }, (tx) =>
    tx`select id, name, username from students order by name limit 100`,
  );
  return c.json(rows);
});

// Scheduled handler: jalan tiap menit via cron trigger di wrangler.toml.
// Transisi otomatis status ujian berdasarkan jadwal.
async function runScheduledJobs(env: Bindings): Promise<{ opened: number; closed: number; expired: number }> {
  const sql = connect(env.HYPERDRIVE.connectionString);
  // Role 'owner' bypass RLS tenant_isolation (lihat policy: app_is_owner() OR ...).
  // schoolId kosong karena 'owner' tidak terikat satu sekolah.
  return await withTenant(sql, { schoolId: "", role: "owner" }, async (tx) => {
      // draft/scheduled → open saat starts_at telah lewat dan belum berakhir.
      const opened = await tx`
        update exams set status = 'open'
        where status in ('draft','scheduled')
          and starts_at is not null and starts_at <= now()
          and (ends_at is null or ends_at > now())
        returning id`;
      // open → closed saat ends_at terlampaui. Juga tutup draft/scheduled
      // yang window-nya sudah lewat sepenuhnya (cron ketinggalan window).
      const closed = await tx`
        update exams set status = 'closed'
        where status in ('open','draft','scheduled')
          and ends_at is not null and ends_at <= now()
        returning id`;
      // Sesi aktif yang deadline-nya lewat → expired, sekalian catat auto-score
      // supaya guru tidak harus menunggu siswa klik submit.
      const expired = await tx`
        update exam_sessions set status = 'expired', finished_at = coalesce(finished_at, now())
        where status = 'active' and deadline_at <= now()
        returning id, exam_id, student_id, school_id`;
      for (const row of expired as unknown as Array<{ id: string; exam_id: string; student_id: string; school_id: string }>) {
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
              else 0 end), 0) as got, coalesce(sum(q.points), 0) as total
          from jsonb_array_elements_text(coalesce(
            (select case
                      when jsonb_typeof(question_order) = 'object' then question_order->'order'
                      when jsonb_typeof(question_order) = 'array'  then question_order
                      else null end
             from exam_sessions where id = ${row.id}),
            (select to_jsonb(array_agg(question_id)) from exam_questions where exam_id = ${row.exam_id})
          )) as qid
          join questions q on q.id = qid.value::uuid
          left join question_keys k on k.question_id = q.id
          left join answers a on a.session_id = ${row.id} and a.question_id = q.id`;
        const sc = g[0] as { got: string; total: string };
        const total = parseFloat(sc.total); const got = parseFloat(sc.got);
        const auto = total > 0 ? (got / total) * 100 : 0;
        await tx`insert into scores (session_id, school_id, exam_id, student_id, auto_score, final_score)
          values (${row.id}, ${row.school_id}, ${row.exam_id}, ${row.student_id}, ${auto}, ${auto})
          on conflict (session_id) do update set auto_score = excluded.auto_score,
             final_score = coalesce(scores.manual_score, excluded.auto_score)`;
      }
      console.log(`cron: opened=${opened.length} closed=${closed.length} expired=${expired.length}`);
      return { opened: opened.length, closed: closed.length, expired: expired.length };
    });
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) {
    await runScheduledJobs(env);
  },
};
