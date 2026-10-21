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

import { Hono } from "hono";
import { connect, withTenant } from "./db";
import {
  Session, sign, verify, cookieHeader, clearCookie, readCookie, randomState,
} from "./session";

export type AuthBindings = {
  HYPERDRIVE: Hyperdrive;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
};

type Mode = "login" | "register";
const SESSION_COOKIE = "cbt_sess";
const STATE_COOKIE = "oauth_state";
const PENDING_COOKIE = "pending_registration";
const SESSION_TTL = 60 * 60 * 8; // 8 jam

function redirectUri(origin: string): string {
  return `${origin}/auth/google/callback`;
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
    prompt: "select_account",
    state,
  });
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
    return c.json({ error: "bad state" }, 400);
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
  if (!ui.email_verified) return c.json({ error: "email not verified" }, 403);

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
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const staff = await sql`select user_id, school_id, role from find_staff_by_email(${email})`;
  if (staff.length === 0) {
    return c.json({ error: "email tidak terdaftar sebagai staf; minta admin mengundang Anda" }, 403);
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
    code: string; name: string; level: "SD" | "SMP" | "SMA" | "CAMPURAN";
    npsn?: string; operator_name: string; operator_phone: string;
  };
  if (!body?.code || !body.name || !body.level || !body.operator_name || !body.operator_phone) {
    return c.json({ error: "missing fields" }, 400);
  }

  const sql = connect(c.env.HYPERDRIVE.connectionString);
  let schoolId: string;
  try {
    const r = await sql`select register_school(
      ${body.code}, ${body.name}, ${body.level}, ${body.npsn ?? null},
      ${body.operator_name}, ${body.operator_phone}, ${pending.email}, ${googleSub}
    ) as id`;
    schoolId = (r[0] as { id: string }).id;
  } catch (e) {
    const msg = (e as Error).message || "register failed";
    return c.json({ error: msg }, 409);
  }

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

auth.post("/auth/logout", (c) => {
  const h = new Headers({ "Content-Type": "application/json" });
  h.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  return new Response(JSON.stringify({ ok: true }), { headers: h });
});

auth.get("/auth/me", async (c) => {
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  if (!token) return c.json({ error: "no session" }, 401);
  const s = await verify(token, c.env.SESSION_SECRET);
  if (!s) return c.json({ error: "bad session" }, 401);
  return c.json({ email: s.email, role: s.role, school_id: s.sid });
});

// Helper untuk route lain: ambil sesi staf dari cookie.
export async function requireStaff(
  cookieHeaderStr: string | null | undefined,
  secret: string,
): Promise<Session | null> {
  const token = readCookie(cookieHeaderStr, SESSION_COOKIE);
  if (!token) return null;
  return verify(token, secret);
}
