// Owner only (needs the CRON_SECRET). Posts the result of a task that was done by hand (or by an AI you run yourself).
//   POST /api/admin/task  { "mint": "<coin mint>", "n": 3, "summary": "one sentence", "detail": "the notes", "status": "done" }
// Leave "n" out to take the oldest task for that coin that isn't done yet. The GitHub Action "post task" calls this.
import { db, eq } from "../../lib/db.js";
import { send, allow, guard, readJson, cronAuthorized } from "../../lib/http.js";
import { isAddress } from "../../lib/keys.js";
import { refreshDone } from "../../lib/tasks.js";

export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  const b = await readJson(req, 16 * 1024);
  const mint = String(b.mint || "").trim(), status = String(b.status || "done"), n = b.n === undefined || b.n === "" ? 0 : Math.floor(Number(b.n));
  const summary = String(b.summary || "").replace(/\s+/g, " ").trim().slice(0, 200), detail = String(b.detail || "").trim().slice(0, 4000);
  if (!isAddress(mint)) return send(res, 400, { error: "mint must be the coin's address." });
  if (!["done", "running", "failed"].includes(status)) return send(res, 400, { error: "status must be done, running or failed." });
  if (!Number.isInteger(n) || n < 0) return send(res, 400, { error: "n must be a task number like 3." });
  if (status === "done" && !summary) return send(res, 400, { error: "Add a one-sentence summary of what was done." });

  const q = n ? `mint=${eq(mint)}&n=eq.${n}` : `mint=${eq(mint)}&status=in.(queued,running,failed)&order=n.asc`;
  const [t] = await db.select("tasks", `${q}&limit=1`);
  if (!t) return send(res, 404, { error: n ? `Task ${n} doesn't exist for that coin yet. It unlocks at ${n} SOL of volume.` : "That coin has no open tasks." });
  const now = new Date().toISOString();
  const patch = { status, source: "team", model: null, ...(status === "running" ? { started_at: now } : { finished_at: now }), ...(summary ? { summary } : {}), ...(detail ? { detail } : {}) };
  await db.update("tasks", `id=eq.${t.id}`, patch);
  const done = await refreshDone(mint).catch(() => null);
  send(res, 200, { ok: true, mint, n: t.n, status, done });
});
