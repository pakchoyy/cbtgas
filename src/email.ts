// Pengiriman email transaksional via Resend (resend.com).
// Dinonaktifkan tanpa error bila RESEND_API_KEY belum di-set — API call tetap
// return success agar flow pemanggil tidak gagal (undangan tetap dibuat).

type EmailEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;   // mis. "CBT Yuk <noreply@bantuguruyuk.web.id>"
  APP_ORIGIN: string;
};

export async function sendEmail(env: EmailEnv, to: string, subject: string, html: string): Promise<
  { ok: true; id?: string } | { ok: false; error: string } | { ok: true; skipped: true }
> {
  if (!env.RESEND_API_KEY) return { ok: true, skipped: true };
  const from = env.EMAIL_FROM || "CBT Yuk <noreply@onboarding.resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) return { ok: false, error: `resend ${r.status}: ${await r.text()}` };
    const j = await r.json() as { id?: string };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function inviteEmail(opts: {
  invitedEmail: string; schoolName: string; role: string; origin: string;
}): { subject: string; html: string } {
  return {
    subject: `Undangan staf ${opts.schoolName} di CBT Yuk`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:20px">
        <h2 style="margin:0 0 12px">Anda diundang sebagai ${esc(opts.role)}</h2>
        <p>Sekolah <b>${esc(opts.schoolName)}</b> mengundang Anda untuk masuk ke
        <b>CBT Yuk</b> (ujian sekolah online).</p>
        <p><a href="${esc(opts.origin)}/auth/google/start?mode=login"
              style="background:#2563EB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
          Masuk dengan Google
        </a></p>
        <p style="color:#777;font-size:13px">Masuklah pakai alamat Google yang
        sama dengan email ini (${esc(opts.invitedEmail)}).</p>
      </div>`,
  };
}

export function pinNotifyEmail(opts: {
  schoolName: string; studentName: string; username: string; origin: string;
}): { subject: string; html: string } {
  return {
    subject: `Permintaan reset PIN siswa — ${opts.studentName}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:20px">
        <h2 style="margin:0 0 12px">Reset PIN siswa</h2>
        <p>Siswa <b>${esc(opts.studentName)}</b>
        (<code>${esc(opts.username)}</code>) meminta reset PIN di
        <b>${esc(opts.schoolName)}</b>.</p>
        <p><a href="${esc(opts.origin)}/app/pin-resets"
          style="background:#2563EB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
          Buka antrian reset
        </a></p>
      </div>`,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]!));
}
