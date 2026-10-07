// Public health check: says which pieces are working. Never prints secret values, only whether they're set.
// ?sim=1 dry-runs a launch transaction on mainnet (simulation only; nothing is sent or paid).
// ?coin=MINT shows that coin's pool wallet and the creator fees waiting in pump.fun's vaults.
import { send, guard, cronAuthorized } from "../lib/http.js";

const ENV = ["SITE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SOLANA_RPC_URL", "POOL_MASTER_SEED", "CRON_SECRET", "PINATA_JWT", "COMPUTE_WALLET", "BUYBACK_WALLET", "LAUNCHES_ENABLED", "PAYOUTS_ENABLED", "PAUSED"];
const run = async f => { try { return { ok: true, ...(await f()) }; } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 400) }; } };

export default guard(async (req, res) => {
  const env = Object.fromEntries(ENV.map(k => [k, !!process.env[k]]));
  const games = await run(async () => { const g = (await import("../lib/games.js")).catalog(); return { games: g.games.length, combos: g.combos.length, problems: g.errors }; });
  const chain = await run(async () => ({ exports: Object.keys(await import("../lib/chain.js")).length }));
  let opsWallet = null;
  try { opsWallet = (await import("../lib/keys.js")).opsWallet(process.env.POOL_MASTER_SEED).publicKey; } catch {}
  const admin = cronAuthorized(req); // ?sim and ?coin cost RPC calls, so they need the CRON_SECRET
  let simulation = null;
  if (admin && req.query && req.query.sim === "1" && chain.ok) simulation = await run(async () => {
    const c = await import("../lib/chain.js"), s = await import("../lib/sol.js");
    // fee payer: a large public exchange wallet, used only so the simulation has SOL to spend on paper
    const b = await c.buildLaunchTx({ user: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", name: "Sim Test", symbol: "SIMT", uri: "https://example.com/m.json", devBuyLamports: 0 });
    const r = await s.rpc("simulateTransaction", [b.tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
    return { bytes: b.bytes, txErr: r.value.err, units: r.value.unitsConsumed, logs: (r.value.logs || []).slice(-10) };
  });
  let coin = null;
  if (admin && req.query && req.query.coin && chain.ok) coin = await run(async () => {
    const c = await import("../lib/chain.js"), s = await import("../lib/sol.js"), k = await import("../lib/keys.js");
    if (!k.isAddress(String(req.query.coin))) throw new Error("bad_mint");
    const pool = c.poolKeypair(String(req.query.coin)).publicKey, v = await c.vaultBalances(pool);
    return { poolWallet: pool, poolBalanceSol: (await s.getBalance(pool)) / 1e9, unclaimedBondingCurveSol: v.bondingCurve / 1e9, unclaimedPumpSwapSol: v.amm / 1e9, opsBalanceSol: opsWallet ? (await s.getBalance(opsWallet)) / 1e9 : null };
  });
  send(res, 200, { node: process.version, opsWallet, launchesEnabled: process.env.LAUNCHES_ENABLED === "1", payoutsEnabled: process.env.PAYOUTS_ENABLED === "1", env, games, chain, simulation, coin });
});
