import { db, eq } from "../lib/db.js";
import { send, allow, guard } from "../lib/http.js";
import { isAddress } from "../lib/keys.js";

// Public, read-only. The AI work feed for one coin: GET /api/tasks?mint=<coin address>. Cached 15s at the edge.
export default guard(async (req, res) => {
  if (!allow(req, res, "GET")) return;
  const mint = String((req.query && req.query.mint) || "");
  if (!isAddress(mint)) return send(res, 400, { error: "mint" });
  const rows = await db.select("tasks", `mint=${eq(mint)}&order=n.desc&limit=40`);
  const ms = t => (t ? Date.parse(t) : 0);
  send(res, 200, {
    tasks: rows.map(t => ({ n: t.n, title: t.title, status: t.status, by: t.source || "", model: t.model || "", summary: t.summary || "", detail: t.detail || "", volSol: +t.vol_sol || 0, at: ms(t.finished_at || t.started_at || t.created_at), unlockedAt: ms(t.created_at) }))
  }, { cache: "public, s-maxage=15, stale-while-revalidate=30" });
});
