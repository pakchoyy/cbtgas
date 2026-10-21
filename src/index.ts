import { Hono } from "hono";
import { connect, withTenant } from "./db";

type Bindings = { HYPERDRIVE: Hyperdrive; APP_ENV: string };
const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));

// Sementara: sekolah dari header. Diganti dengan sesi cookie HttpOnly di langkah auth.
app.get("/api/students", async (c) => {
  const schoolId = c.req.header("x-school-id");
  if (!schoolId) return c.json({ error: "missing school" }, 400);
  const sql = connect(c.env.HYPERDRIVE.connectionString);
  const rows = await withTenant(sql, { schoolId, role: "teacher" }, (tx) =>
    tx`select id, name, username from students order by name limit 100`,
  );
  return c.json(rows);
});

export default app;
