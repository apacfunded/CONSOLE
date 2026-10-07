import { db, eq } from "../../lib/db.js";
import { getTx } from "../../lib/rpc.js";
import { isAddress } from "../../lib/keys.js";
import { send, allow, guard, readJson, sameOrigin, limited } from "../../lib/http.js";
import { PUMP_PROGRAM, verifyLaunched } from "../../lib/chain.js";

// Marks a launch live once the transaction is confirmed on Solana. We check the chain ourselves;
// the request only tells us where to look.
export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (!sameOrigin(req)) return send(res, 403, { error: "origin" });
  if (await limited(req, res, "confirm", 30, 600)) return;
  const b = await readJson(req);
  if (!isAddress(b.mint) || !isAddress(b.creator) || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(String(b.signature || ""))) return send(res, 400, { error: "bad_request" });
  const coin = (await db.select("coins", `mint=${eq(b.mint)}`))[0];
  if (!coin) return send(res, 404, { error: "unknown" });
  if (coin.confirmed) return send(res, 200, { ok: true });
  if (coin.creator !== b.creator) return send(res, 403, { error: "creator" });

  let tx = null;
  for (let i = 0; i < 6 && !tx; i++) { tx = await getTx(b.signature).catch(() => null); if (!tx) await new Promise(r => setTimeout(r, 1500)); }
  if (!tx) return send(res, 202, { pending: true }); // the tick job confirms it later
  const keys = tx.transaction.message.accountKeys.map(k => k.pubkey || k);
  const ok = !tx.meta.err && keys[0] === coin.creator && keys.includes(coin.mint) && keys.includes(PUMP_PROGRAM);
  if (!ok) return send(res, 400, { error: "not_a_launch" });
  // the transaction alone isn't proof: the coin must exist on pump.fun with its pool wallet as creator
  if (!(await verifyLaunched(coin.mint).catch(() => false))) return send(res, 202, { pending: true });
  try { await db.update("coins", `mint=${eq(b.mint)}`, { confirmed: true, launch_sig: b.signature }); }
  catch (e) { if (e.status === 409) return send(res, 409, { error: "This game already has a live coin." }); throw e; }
  await db.insert("activity", [{ kind: "launch", mint: coin.mint, target: coin.target, wallet: coin.creator, tx: b.signature }]).catch(() => {});
  send(res, 200, { ok: true });
});
