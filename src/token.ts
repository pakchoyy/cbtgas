// Token ujian 6 huruf yang berganti tiap 15 menit. Diturunkan dari rahasia
// server + id ujian + jendela waktu, jadi tidak perlu disimpan di database.
const SLOT_MS = 15 * 60 * 1000;
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa I, O, 0, 1 supaya tidak tertukar

async function tokenFor(secret: string, examId: string, slot: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${examId}:${slot}`)));
  return [...mac.slice(0, 6)].map((b) => ABC[b % ABC.length]).join("");
}

export async function currentToken(secret: string, examId: string): Promise<{ token: string; expiresIn: number }> {
  const now = Date.now(), slot = Math.floor(now / SLOT_MS);
  return { token: await tokenFor(secret, examId, slot), expiresIn: Math.ceil(((slot + 1) * SLOT_MS - now) / 1000) };
}

// Token jendela sekarang atau sebelumnya diterima (siswa yang mengetik tepat saat berganti).
export async function tokenValid(secret: string, examId: string, input: string): Promise<boolean> {
  const t = input.trim().toUpperCase(), slot = Math.floor(Date.now() / SLOT_MS);
  return t === await tokenFor(secret, examId, slot) || t === await tokenFor(secret, examId, slot - 1);
}
