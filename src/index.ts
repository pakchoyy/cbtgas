import { Hono } from "hono";
import { connect, withTenant, edgeCache } from "./db";
import { auth, requireStaff, AuthBindings } from "./auth";
import { pages } from "./pages";
import { api } from "./api";
import { student } from "./student";
import { finalizeSession } from "./scoring";
import { verify, readCookie } from "./session";
import { brandHex, APP_NAME } from "./ui";

type Bindings = AuthBindings & { APP_ENV: string };
const app = new Hono<{ Bindings: Bindings }>();

// Warna merek sekolah yang sedang login (staf atau siswa). Halaman memuat
// file ini setelah CSS dasar, jadi cukup menimpa --brand.
app.get("/brand.css", async (c) => {
  const cookie = c.req.header("Cookie");
  const tok = readCookie(cookie, "cbt_sess") ?? readCookie(cookie, "cbt_sstu");
  const s = tok ? await verify(tok, c.env.SESSION_SECRET) : null;
  const headers = { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "private, max-age=600" };
  if (!s?.sid) return new Response(`:root{--brand:${brandHex(null)}}`, { headers });
  // Warna per sekolah disimpan di cache edge; dihapus saat admin mengganti warna (PATCH /api/school).
  const key = new Request(`https://cache.cbt-yuk/brand/${s.sid}`);
  const hit = await edgeCache().match(key);
  if (hit) return new Response(hit.body, { headers });
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const r = await withTenant(sql, { schoolId: s.sid, role: s.role, userId: s.uid }, (tx) =>
    tx`select color from schools where id = ${s.sid}`);
  const css = `:root{--brand:${brandHex((r[0] as { color: string } | undefined)?.color)}}`;
  c.executionCtx.waitUntil(edgeCache().put(key, new Response(css, { headers: { "Cache-Control": "public, max-age=86400" } })));
  return new Response(css, { headers });
});

app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));

// Shared bank soal publik: SIAPA SAJA bisa unduh via /public/banks/:slug.
// Pakai SECURITY DEFINER function public_bank() yang mem-bypass RLS tenant
// (tanpa membocorkan data sekolah lain — hanya payload yang guru upload).
app.get("/public/banks/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) return c.json({ error: "slug tidak valid" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  // Set konteks owner agar function call diizinkan grant-nya ke cbt_app.
  const rows = await withTenant(sql, { schoolId: "", role: "owner" }, async (tx) => {
    const r = await tx`select * from public_bank(${slug})`;
    if (r.length) await tx`select increment_bank_download(${slug})`;
    return r;
  });
  if (rows.length === 0) return c.json({ error: "bank tidak ditemukan" }, 404);
  const row = rows[0] as { slug: string; title: string; description: string | null; payload: unknown; download_count: number };
  // Download sebagai attachment supaya langsung simpan file.
  return new Response(JSON.stringify({
    slug: row.slug, title: row.title, description: row.description,
    download_count: row.download_count, payload: row.payload,
  }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bank-${slug}.json"`,
      "Cache-Control": "public, max-age=60",
    },
  });
});

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
  id: "/",
  name: `${APP_NAME} · Ujian Sekolah Online`,
  short_name: APP_NAME,
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#F5F7FB",
  theme_color: "#2563EB",
  description: "Ujian berbasis komputer untuk SD, SMP, dan SMA: buat soal, jadwalkan, awasi, dan nilai otomatis.",
  categories: ["education"],
  icons: [
    { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
    { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
    { src: "/icon-maskable.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
  ],
}));

// Logo: gelembung jawaban yang sudah dicentang di atas kotak biru.
const iconSvg = (pad: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B9BFF"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient></defs>
  <rect width="512" height="512" rx="${pad ? 0 : 116}" fill="#fff"/>
  <g transform="translate(${56 + pad / 2} ${56 + pad / 2}) scale(${(400 - pad) / 32})">
    <path d="M23.1 8.9A10 10 0 1 0 23.1 23.1" fill="none" stroke="url(#g)" stroke-width="6.4" stroke-linecap="round"/>
    <circle cx="15.6" cy="16" r="3.1" fill="#2563EB"/>
    <path d="M19.6 16.6l2.6 2.6 6.4-6.8" fill="none" stroke="#2563EB" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
const svgRes = (body: string) => new Response(body, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
app.get("/icon-192.svg", () => svgRes(iconSvg(0)));
app.get("/icon-512.svg", () => svgRes(iconSvg(0)));
app.get("/icon-maskable.svg", () => svgRes(iconSvg(40)));
app.get("/favicon.ico", () => svgRes(iconSvg(0)));

// Service worker: hanya cache shell (landing + login siswa). Semua request
// data (/api/*, /s/take/*) selalu network. Dibatasi runtime cache ringan
// untuk GET /s/login & / supaya PWA bisa buka saat offline sampai login.
app.get("/sw.js", (c) => {
  const sw = `const CACHE = 'cbtyuk-shell-v3';
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
  const sess = await requireStaff(c.req.header("Cookie"), c.env.SESSION_SECRET, c.env.HYPERDRIVE);
  if (!sess) return c.json({ error: "unauthorized" }, 401);
  const schoolId = sess.sid, role = sess.role, userId = sess.uid;

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
      const expired = await tx`select id from exam_sessions where status = 'active' and deadline_at <= now()`;
      for (const row of expired as unknown as Array<{ id: string }>) await finalizeSession(tx, row.id, "expired");
      await tx`delete from rate_counters where window_start < now() - interval '1 day'`;
      // Siswa tamu dari tombol demo (beserta sesi & jawabannya) dihapus setelah 6 jam.
      await tx`delete from students where username like 'tamu-%' and created_at < now() - interval '6 hours'
               and school_id = (select id from schools where code = 'demo-sma')`;
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
