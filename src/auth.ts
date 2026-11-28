// Google OAuth 2.0 untuk sesi staf (admin/teacher/proctor) dan registrasi sekolah baru.
//
// Flow:
//   GET /auth/google/start?mode=login|register
//     - Set cookie oauth_state (nilai acak + mode) → redirect ke accounts.google.com.
//   GET /auth/google/callback?code=...&state=...
//     - Validasi state, tukar code, ambil userinfo (email, sub, name).
//     - mode=login  : find_staff_by_email → sign session cookie, redirect ke /app.
//     - mode=register: set cookie pending_registration (email+sub, 10 menit), redirect ke /register.
//   POST /auth/register-school
//     - Baca cookie pending_registration, panggil register_school(...), sign session, redirect.
//   POST /auth/logout → hapus cookie.
//
// Env/secret yang dibutuhkan di Worker:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (secret), SESSION_SECRET (secret), APP_ORIGIN.

import { findStaffByEmail, findStaffForPassword, registerSchool, resolveSchool } from "./dbfn";
import { verifyPin } from "./hash";
import { checkOrLimit } from "./ratelimit";
import { Hono } from "hono";
import { SHARED_CSS } from "./ui";
import { connectDb, type DbEnv, withTenant } from "./db";
import { catchUp } from "./catchup";
import {
  type Session, sign, verify, cookieHeader, clearCookie, readCookie, randomState,
} from "./session";

export type AuthBindings = {
  HYPERDRIVE: Hyperdrive;
  // Pemilih backend: kosong = Neon (bawaan). "d1" = Cloudflare D1 (butuh binding DB di wrangler.toml).
  DB_BACKEND?: string;
  DB?: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
  DEMO_LOGIN?: string;
};

type Mode = "login" | "register";
const SESSION_COOKIE = "cbt_sess";
const STATE_COOKIE = "oauth_state";
const PENDING_COOKIE = "pending_registration";
// Email Google terakhir yang berhasil masuk: login berikutnya langsung ke akun itu (login_hint) tanpa pemilih akun.
// Dihapus saat keluar. "?ganti=1" memaksa pemilih akun.
const HINT_COOKIE = "cbt_hint";
const HINT_TTL = 60 * 60 * 24 * 180; // 180 hari
const SESSION_TTL = 60 * 60 * 8; // 8 jam

function redirectUri(origin: string): string {
  return `${origin}/auth/google/callback`;
}


// Galat login ditampilkan sebagai halaman, bukan JSON mentah.
function authError(title: string, detail: string, status: number): Response {
  const esc = (t: string) => t.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · CBT Yuk</title><style>${SHARED_CSS} main{max-width:520px;margin:10vh auto;padding:0 20px}</style></head>
<body><main><div class="card"><h1>${esc(title)}</h1><p class="sub">${esc(detail)}</p>
<div class="row"><a class="btn primary" href="/">Kembali ke beranda</a><a class="btn" href="/auth/google/start?mode=register">Daftarkan sekolah baru</a></div></div></main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const auth = new Hono<{ Bindings: AuthBindings }>();

auth.get("/auth/google/start", (c) => {
  const mode = (c.req.query("mode") as Mode) ?? "login";
  if (mode !== "login" && mode !== "register") return c.json({ error: "bad mode" }, 400);

  const state = `${randomState()}.${mode}`;
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c.env.APP_ORIGIN),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    state,
  });
  const hint = mode === "login" && c.req.query("ganti") !== "1" ? readCookie(c.req.header("Cookie"), HINT_COOKIE) : null;
  if (hint) params.set("login_hint", decodeURIComponent(hint));
  else params.set("prompt", "select_account");
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  const h = new Headers({ Location: url });
  // state cookie: 10 menit, cukup untuk round-trip
  h.append("Set-Cookie", cookieHeader(STATE_COOKIE, state, { maxAge: 600 }));
  return new Response(null, { status: 302, headers: h });
});

auth.get("/auth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = readCookie(c.req.header("Cookie"), STATE_COOKIE);
  if (!code || !state || !cookieState || state !== cookieState) {
    return authError("Sesi login kedaluwarsa", "Silakan mulai masuk dengan Google dari awal.", 400);
  }
  const mode = (state.split(".")[1] as Mode) ?? "login";

  // Tukar code → token
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(c.env.APP_ORIGIN),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResp.ok) return c.json({ error: "token exchange failed" }, 502);
  const token = (await tokenResp.json()) as { access_token: string; id_token?: string };

  // Userinfo (email, sub, name)
  const uiResp = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!uiResp.ok) return c.json({ error: "userinfo failed" }, 502);
  const ui = (await uiResp.json()) as {
    sub: string; email: string; email_verified?: boolean; name?: string;
  };
  if (!ui.email_verified) return authError("Email belum terverifikasi", "Verifikasi email Google Anda terlebih dahulu.", 403);

  const email = ui.email.toLowerCase();
  const headers = new Headers({ "Set-Cookie": clearCookie(STATE_COOKIE) });

  if (mode === "register") {
    // Simpan email+sub di cookie HttpOnly, ditandatangani, 10 menit.
    const pending = await sign(
      { uid: "", sid: "", role: "admin", email, exp: Math.floor(Date.now() / 1000) + 600 } as Session,
      c.env.SESSION_SECRET,
    );
    headers.append("Set-Cookie", cookieHeader(PENDING_COOKIE, `${pending}|${ui.sub}`, { maxAge: 600 }));
    headers.set("Location", `${c.env.APP_ORIGIN}/register`);
    return new Response(null, { status: 302, headers });
  }

  // mode = login: cari staf yang email-nya diundang di sekolah manapun.
  const sql = connectDb(c.env);
  const staff = await findStaffByEmail(sql, email);
  if (staff.length === 0) {
    // Pemilik layanan tanpa sekolah: langsung ke halaman pemantauan.
    if ((await sql`select 1 from system_owners where email = ${email}`).length) {
      const own: Session = { uid: "", sid: "", role: "owner", email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL };
      headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, await sign(own, c.env.SESSION_SECRET), { maxAge: SESSION_TTL }));
      headers.append("Set-Cookie", cookieHeader(HINT_COOKIE, encodeURIComponent(email), { maxAge: HINT_TTL }));
      headers.set("Location", `${c.env.APP_ORIGIN}/owner`);
      return new Response(null, { status: 302, headers });
    }
    return authError("Email ini belum terdaftar",
      `${email} belum menjadi staf di sekolah mana pun. Minta admin sekolah mengundang email ini, atau daftarkan sekolah baru dengan akun ini.`, 403);
  }
  if (staff.length > 1) {
    // Email yang sama diundang di beberapa sekolah: butuh pemilih di frontend.
    return c.json({ error: "multiple schools", options: staff }, 300);
  }
  const row = staff[0] as { user_id: string; school_id: string; role: Session["role"] };

  // Catat google_sub kalau belum (set pakai transaksi RLS-aware)
  await withTenant(sql, { schoolId: row.school_id, role: row.role, userId: row.user_id }, (tx) =>
    tx`update users set google_sub = ${ui.sub} where id = ${row.user_id} and google_sub is null`,
  );

  const session: Session = {
    uid: row.user_id,
    sid: row.school_id,
    role: row.role,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  };
  const cookie = await sign(session, c.env.SESSION_SECRET);
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, cookie, { maxAge: SESSION_TTL }));
  headers.append("Set-Cookie", cookieHeader(HINT_COOKIE, encodeURIComponent(email), { maxAge: HINT_TTL }));
  headers.set("Location", `${c.env.APP_ORIGIN}/app`);
  return new Response(null, { status: 302, headers });
});

auth.post("/auth/register-school", async (c) => {
  const raw = readCookie(c.req.header("Cookie"), PENDING_COOKIE);
  if (!raw) return c.json({ error: "no pending registration" }, 400);
  const [token, googleSub] = raw.split("|");
  const pending = await verify(token, c.env.SESSION_SECRET);
  if (!pending || !pending.email || !googleSub) return c.json({ error: "pending expired" }, 400);

  const body = (await c.req.json().catch(() => null)) as null | {
    name: string; level: "SD" | "SMP" | "SMA" | "CAMPURAN";
    npsn?: string; operator_name: string; operator_phone: string;
  };
  if (!body?.name?.trim() || !body.level || !body.operator_name?.trim() || !body.operator_phone?.trim()) {
    return c.json({ error: "Lengkapi nama sekolah, jenjang, nama operator, dan nomor HP." }, 400);
  }

  // Kode sekolah dibuat otomatis dari nama (dipakai internal, siswa tidak perlu tahu).
  const slug = body.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  const baseCode = slug.length >= 3 ? slug : `sekolah-${slug}`.replace(/-+$/, "");
  const sql = connectDb(c.env);
  let schoolId = "";
  for (let attempt = 0; attempt < 6 && !schoolId; attempt++) {
    const code = attempt === 0 ? baseCode : `${baseCode}-${1000 + Math.floor(Math.random() * 9000)}`;
    try {
      schoolId = await registerSchool(sql, {
        code, name: body.name.trim(), level: body.level, npsn: body.npsn?.trim() || null,
        operator_name: body.operator_name.trim(), operator_phone: body.operator_phone.trim(),
        admin_email: pending.email, google_sub: googleSub,
      });
    } catch (e) {
      const err = e as { code?: string; constraint_name?: string; message?: string };
      // Bentrok kode → coba lagi dengan akhiran acak. Galat lain langsung dilaporkan.
      if (err.code === "23505" && (err.constraint_name ?? "").includes("code")) continue;
      return c.json({ error: err.message || "Pendaftaran gagal." }, 409);
    }
  }
  if (!schoolId) return c.json({ error: "Pendaftaran gagal, coba lagi." }, 409);

  // Ambil user admin yang baru dibuat (sudah di-insert oleh register_school)
  const u = await withTenant(
    sql, { schoolId, role: "admin" },
    (tx) => tx`select id from users where email = ${pending.email} and school_id = ${schoolId}`,
  );
  const userId = (u[0] as { id: string }).id;

  const session: Session = {
    uid: userId, sid: schoolId, role: "admin", email: pending.email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  };
  const cookie = await sign(session, c.env.SESSION_SECRET);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", clearCookie(PENDING_COOKIE));
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, cookie, { maxAge: SESSION_TTL }));
  return new Response(JSON.stringify({ ok: true, school_id: schoolId }), { status: 201, headers });
});

// Masuk dengan email + password (untuk guru yang tidak memakai akun Google). Password dibuat admin di "Guru & admin".
// Perlindungan: 60/menit per IP, 10/menit per email, akun terkunci 15 menit setelah 5 password salah.
auth.post("/auth/login-password", async (c) => {
  const rl = await checkOrLimit(c.env, c.req.raw.headers, "staff_pw", 60);
  if (rl) return rl;
  const body = await c.req.json().catch(() => null) as null | { email?: string; password?: string };
  const email = String(body?.email ?? "").trim().toLowerCase(), password = String(body?.password ?? "");
  if (!email || !password) return c.json({ error: "Isi email dan password." }, 400);
  const rle = await checkOrLimit(c.env, c.req.raw.headers, "staff_pw_e", 10, "e:" + email.slice(0, 120));
  if (rle) return rle;
  const sql = connectDb(c.env);
  type Cand = { user_id: string; school_id: string; role: Session["role"]; password_hash: string; pw_failed: number; pw_locked_until: string | null };
  const cands = await findStaffForPassword(sql, email) as unknown as Cand[];
  const locked = (x: Cand) => !!x.pw_locked_until && new Date(x.pw_locked_until).getTime() > Date.now();
  let hit: Cand | null = null;
  for (const x of cands) if (!locked(x) && await verifyPin(password, x.password_hash)) { hit = x; break; }
  if (!hit) {
    if (cands.length === 1) {
      const x = cands[0];
      if (locked(x)) return c.json({ error: "Akun terkunci 15 menit karena password salah berkali-kali. Coba lagi nanti atau minta admin membuat password baru." }, 423);
      const next = x.pw_failed + 1, lock = next >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      await withTenant(sql, { schoolId: x.school_id, role: x.role, userId: x.user_id }, (tx) =>
        tx`update users set pw_failed = ${next}, pw_locked_until = ${lock} where id = ${x.user_id}`);
    }
    return c.json({ error: "Email atau password salah." }, 401);
  }
  if (hit.pw_failed || hit.pw_locked_until) await withTenant(sql, { schoolId: hit.school_id, role: hit.role, userId: hit.user_id }, (tx) =>
    tx`update users set pw_failed = 0, pw_locked_until = null where id = ${hit!.user_id}`);
  const session: Session = { uid: hit.user_id, sid: hit.school_id, role: hit.role, email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL };
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, await sign(session, c.env.SESSION_SECRET), { maxAge: SESSION_TTL }));
  return new Response(JSON.stringify({ ok: true, redirect: "/app" }), { headers });
});

auth.post("/auth/logout", (c) => {
  const h = new Headers({ Location: "/" });
  h.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  h.append("Set-Cookie", clearCookie(HINT_COOKIE)); // komputer bersama: guru berikutnya memilih akunnya sendiri
  return new Response(null, { status: 302, headers: h });
});

// Login shortcut untuk demo. Hanya aktif saat DEMO_LOGIN = "1".
// Login sebagai admin pertama di sekolah demo-sma.
auth.post("/auth/dev-login", async (c) => {
  if (c.env.DEMO_LOGIN !== "1") {
    return c.json({ error: "disabled" }, 404);
  }
  const sql = connectDb(c.env);
  // resolve_school SECURITY DEFINER → aman tanpa RLS context.
  const sch = await resolveSchool(sql, 'demo-sma');
  if (sch.length === 0) return c.json({ error: "demo school not seeded" }, 404);
  const sid = (sch[0] as { id: string }).id;
  const row = await withTenant(sql, { schoolId: sid, role: "admin" }, (tx) =>
    tx`select id as uid, email from users where role = 'admin' order by created_at limit 1`,
  );
  if (row.length === 0) return c.json({ error: "demo admin not seeded" }, 404);
  const u = row[0] as { uid: string; email: string };
  const r = { uid: u.uid, sid, role: "admin" as const, email: u.email };
  const session: Session = {
    uid: r.uid, sid: r.sid, role: r.role, email: r.email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  };
  const cookie = await sign(session, c.env.SESSION_SECRET);
  const headers = new Headers({ Location: "/app" });
  headers.append("Set-Cookie", cookieHeader(SESSION_COOKIE, cookie, { maxAge: SESSION_TTL }));
  return new Response(null, { status: 302, headers });
});

auth.get("/auth/me", async (c) => {
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  if (!token) return c.json({ error: "no session" }, 401);
  const s = await verify(token, c.env.SESSION_SECRET);
  if (!s) return c.json({ error: "bad session" }, 401);
  return c.json({ email: s.email, role: s.role, school_id: s.sid });
});

// Helper untuk route lain: ambil sesi staf dari cookie. Token siswa tidak
// lolos (cek role), dan staf yang dinonaktifkan langsung kehilangan akses
// tanpa menunggu cookie kedaluwarsa (cek users.active lewat find_staff_by_email).
const STAFF_ROLES = new Set(["admin", "teacher", "proctor"]);
export async function requireStaff(
  cookieHeaderStr: string | null | undefined,
  secret: string,
  env: DbEnv,
): Promise<Session | null> {
  const token = readCookie(cookieHeaderStr, SESSION_COOKIE);
  if (!token) return null;
  const s = await verify(token, secret);
  if (!s || !STAFF_ROLES.has(s.role) || !s.email) return null;
  // shortcut: hasil cek akun aktif disimpan 60 dtk per isolate Worker; staf yang
  // dinonaktifkan kehilangan akses paling lambat 1 menit kemudian.
  const key = `${s.uid}:${s.sid}`, hit = staffOk.get(key);
  // Jadwal ujian (buka/tutup) dan sesi kedaluwarsa diproses saat aplikasi dipakai.
  await catchUp(connectDb(env), s.sid);
  if (hit && hit > Date.now()) return s;
  const sql = connectDb(env);
  const rows = (await findStaffByEmail(sql, s.email)).filter((r) => r.user_id === s.uid && r.school_id === s.sid);
  if (!rows.length) { staffOk.delete(key); return null; }
  if (staffOk.size > 5000) staffOk.clear();
  staffOk.set(key, Date.now() + 60_000);
  return s;
}
const staffOk = new Map<string, number>();

// Pemilik layanan (tabel system_owners), boleh punya sekolah atau tidak.
export async function requireOwner(cookieHeaderStr: string | null | undefined, secret: string, env: DbEnv): Promise<Session | null> {
  const token = readCookie(cookieHeaderStr, SESSION_COOKIE);
  const s = token ? await verify(token, secret) : null;
  if (!s?.email) return null;
  const sql = connectDb(env);
  return (await sql`select 1 from system_owners where email = ${s.email.toLowerCase()}`).length ? s : null;
}
