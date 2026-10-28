// Helper audit log: panggil dari dalam withTenant transaction supaya RLS +
// school_id otomatis ter-attach. Pattern pemakaian:
//   await audit(tx, sess, "exam.open", "exam", examId, { title: "..." })
import type { Session } from "./session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function audit(
  tx: any,
  actor: { sid: string; uid?: string; email?: string; role?: string },
  action: string,
  entity: string | null = null,
  entity_id: string | null = null,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await tx`
    insert into audit_log (school_id, actor_id, actor_email, actor_role, action, entity, entity_id, details)
    values (${actor.sid}, ${actor.uid ?? null}, ${actor.email ?? null}, ${actor.role ?? null},
            ${action}, ${entity}, ${entity_id}, ${details as unknown as string})
  `;
}

// Konversi dari Session.
export function actorFromSession(s: Session): { sid: string; uid?: string; email?: string; role?: string } {
  return { sid: s.sid, uid: s.uid, email: s.email, role: s.role };
}
