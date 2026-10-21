// PBKDF2-SHA256 untuk PIN siswa. Format simpan: pbkdf2$<iter>$<saltB64>$<hashB64>.
// Kompatibel Workers (Web Crypto SubtleCrypto).

const enc = new TextEncoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function b64d(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as ArrayBuffer, iterations: iter },
    base, 256,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = new Uint8Array(16); crypto.getRandomValues(salt);
  // Workers Crypto membatasi iterasi PBKDF2 maksimum 100.000.
  const iter = 100_000;
  const h = await derive(pin, salt, iter);
  return `pbkdf2$${iter}$${b64(salt)}$${b64(h)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, iterS, saltB64, hashB64] = stored.split("$");
  if (alg !== "pbkdf2") return false;
  const h = await derive(pin, b64d(saltB64), parseInt(iterS, 10));
  const want = b64d(hashB64);
  if (h.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < h.length; i++) diff |= h[i] ^ want[i];
  return diff === 0;
}
