// Cookie sesi: payload JSON + HMAC-SHA256(SESSION_SECRET). HttpOnly, Secure, SameSite=Lax.
// Dipakai untuk sesi staf (admin/teacher/proctor) setelah OAuth Google berhasil.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export type Session = {
  uid: string;        // users.id
  sid: string;        // schools.id
  role: "admin" | "teacher" | "proctor";
  email: string;
  exp: number;        // epoch seconds
};

export async function sign(session: Session, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verify(token: string, secret: string): Promise<Session | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const key = await hmacKey(secret);
  const sigBytes = b64urlDecode(sig);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer, enc.encode(payload));
  if (!ok) return null;
  try {
    const s = JSON.parse(dec.decode(b64urlDecode(payload))) as Session;
    if (s.exp && s.exp < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch { return null; }
}

export function cookieHeader(name: string, value: string, opts: { maxAge?: number; path?: string } = {}): string {
  const parts = [`${name}=${value}`, "HttpOnly", "Secure", "SameSite=Lax", `Path=${opts.path ?? "/"}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}
export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

// Random state (base64url) untuk pre-OAuth CSRF/replay.
export function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}
