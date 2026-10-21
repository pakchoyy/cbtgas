import { Hono } from "hono";
import { connect, withTenant } from "./db";
import { auth, requireStaff, AuthBindings } from "./auth";
import { pages } from "./pages";

type Bindings = AuthBindings & { APP_ENV: string };
const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));

app.route("/", auth);
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

export default app;
