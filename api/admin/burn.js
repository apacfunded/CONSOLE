// Owner only (needs the CRON_SECRET). Records a $CONSOLE buyback-and-burn done by hand from the buyback wallet,
// so the site can show "total burned" and a burn ledger. The transaction is checked on chain first.
//   POST /api/admin/burn  { "tx": "<signature>", "tokens": 1234567, "sol": 0.5, "note": "optional" }
// The easy way to call it: GitHub → Actions → "record burn" → Run workflow.
import { db } from "../../lib/db.js";
import { getTx } from "../../lib/rpc.js";
import { send, allow, guard, readJson, cronAuthorized } from "../../lib/http.js";
import { isAddress } from "../../lib/keys.js";

const SIG = /^[1-9A-HJ-NP-Za-km-z]{60,100}$/;

export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  const b = await readJson(req);
  const tx = String(b.tx || "").trim(), tokens = Number(b.tokens), sol = Number(b.sol || 0), note = String(b.note || "").slice(0, 160);
  if (!SIG.test(tx)) return send(res, 400, { error: "Paste the burn transaction's signature (the long code from Solscan)." });
  if (!Number.isFinite(tokens) || tokens <= 0) return send(res, 400, { error: "Say how many $CONSOLE tokens were burned, as a number." });
  if (!Number.isFinite(sol) || sol < 0 || sol > 10_000) return send(res, 400, { error: "sol must be the SOL spent on the buyback, 0 or more." });
  const wallet = process.env.BUYBACK_WALLET || "";
  if (!isAddress(wallet)) return send(res, 500, { error: "BUYBACK_WALLET is not set." });

  const t = await getTx(tx).catch(() => null);
  if (!t) return send(res, 404, { error: "That transaction isn't on chain yet. Wait a minute and try again." });
  if (t.meta && t.meta.err) return send(res, 400, { error: "That transaction failed on chain, so it can't be recorded." });
  const keys = ((t.transaction && t.transaction.message && t.transaction.message.accountKeys) || []).map(k => k.pubkey || k);
  if (!keys.includes(wallet)) return send(res, 400, { error: "That transaction doesn't involve the buyback wallet." });

  try { await db.insert("burns", [{ tx, sol_lamports: Math.round(sol * 1e9), tokens, note }]); }
  catch (e) { if (e.status === 409) return send(res, 409, { error: "That burn is already recorded." }); throw e; }
  await db.insert("activity", [{ kind: "burn", wallet, lamports: Math.round(sol * 1e9), tx }]).catch(() => {});
  send(res, 200, { ok: true, tx, tokens, sol });
});
