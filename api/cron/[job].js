// Background jobs, called every few minutes by GitHub Actions with the CRON_SECRET (Vercel Hobby cron only runs daily).
//   /api/cron/tick    confirm launches, refresh market caps
//   /api/cron/claim   claim pump.fun creator fees into each coin's pool wallet
//   /api/cron/work    run queued AI tasks (one unlocks per TASK_EVERY_SOL of volume); needs ANTHROPIC_API_KEY
//   /api/cron/payout  split any pool at the threshold: 10% buyback, then the dev's pick between AI compute and the dev
//                     (only when PAYOUTS_ENABLED=1; otherwise a dry run that shows what it would send)
import { db, eq } from "../../lib/db.js";
import { send, guard, cronAuthorized, paused } from "../../lib/http.js";
import { currentMcUsd } from "../../lib/mc.js";
import { planSplit, validAiPct, LAMPORTS } from "../../lib/payout.js";
import { isAddress } from "../../lib/keys.js";
import { claimFees, balance, sendFromPool, vaultBalances, verifyLaunched } from "../../lib/chain.js";
import { pmap, budget, claimPageSize } from "../../lib/batch.js";
import { unlockTasks, askModel, namesFor, refreshDone } from "../../lib/tasks.js";

const RENT_KEEP = 2_000_000; // leave a little in each pool wallet for rent + network fees

async function tick() {
  const out = { confirmed: 0, mc: 0 }, time = budget();
  // launches whose confirm call never arrived: live if the mint account exists on chain (6 checked at once)
  const pending = await db.select("coins", `confirmed=eq.false&created_at=lt.${new Date(Date.now() - 120e3).toISOString()}&created_at=gt.${new Date(Date.now() - 864e5).toISOString()}&order=created_at.asc&limit=200`);
  await pmap(pending, 6, async c => {
    if (time.over() || !(await verifyLaunched(c.mint).catch(() => false))) return;
    try { await db.update("coins", `mint=${eq(c.mint)}`, { confirmed: true }); out.confirmed++; }
    catch (e) { out.duplicate = (out.duplicate || []).concat({ mint: c.mint, status: e.status }); } // combo already has a live coin
  });
  // market caps: one RPC call per 100 coins, then database writes 8 at a time
  const coins = await db.select("coins", "confirmed=eq.true&select=mint&limit=1000");
  const mcs = await currentMcUsd(coins.map(c => c.mint));
  const t = new Date().toISOString();
  const hist = Object.entries(mcs).map(([mint, mc]) => ({ mint, t, mc }));
  if (hist.length) { await db.insert("mc_history", hist); out.mc = hist.length; }
  await pmap(Object.entries(mcs), 8, ([mint, mc]) => db.update("coins", `mint=${eq(mint)}`, { mc }));
  await db.rpc("cleanup", {}).catch(() => {});
  out.ms = time.spent();
  return out;
}

// Claims fees for a page of coins per run: the ones claimed longest ago go first, so with many coins every
// one is still reached every few runs. Four coins are worked on at once, and the run stops at its time budget.
async function claim() {
  const time = budget(), page = claimPageSize();
  const total = await db.select("coins", "confirmed=eq.true&select=mint&limit=1000");
  const coins = await db.select("coins", `confirmed=eq.true&order=claimed_at.asc.nullsfirst,created_at.asc&limit=${page}`);
  const results = await pmap(coins, 4, async c => {
    if (time.over()) return { mint: c.mint, skipped: "time_budget" };
    let r;
    try { r = await claimFees(c.mint); if (r.sig) await db.insert("activity", [{ kind: "claim", mint: c.mint, target: c.target, wallet: c.pool_wallet, lamports: r.vault || 0, tx: r.sig }]); }
    catch (e) { r = { error: e.message }; }
    // pool shown on the site = SOL already in the pool wallet + fees still waiting in pump.fun's vaults
    const bal = await balance(c.pool_wallet).catch(() => null);
    const waiting = r.sig ? 0 : await vaultBalances(c.pool_wallet).then(v => v.bondingCurve + v.amm).catch(() => 0);
    const patch = { claimed_at: new Date().toISOString() };
    if (bal !== null) patch.pool_lamports = Math.max(0, bal - RENT_KEEP) + waiting;
    // lifetime fees = everything claimed so far + what is still waiting; trading volume is estimated from it
    if (r.sig) patch.fees_lamports = (+c.fees_lamports || 0) + (r.vault || 0);
    if (r.sig || bal !== null) patch.fees_waiting_lamports = r.sig ? 0 : waiting;
    await db.update("coins", `mint=${eq(c.mint)}`, patch).catch(() => {});
    // every TASK_EVERY_SOL of volume earns one AI task
    let unlocked = 0;
    try { unlocked = (await unlockTasks({ ...c, ...patch })).unlocked; } catch (e) { r.tasksError = String(e.message || e).slice(0, 120); }
    return { mint: c.mint, ...r, tasksUnlocked: unlocked };
  });
  return { page, coins: total.length, looked_at: coins.length, ms: time.spent(), results };
}

async function payout() {
  const live = process.env.PAYOUTS_ENABLED === "1";
  const capSol = Number(process.env.MAX_PAYOUT_SOL_PER_RUN || "5");
  if (!Number.isFinite(capSol) || capSol <= 0) return { error: "MAX_PAYOUT_SOL_PER_RUN must be a number of SOL, like 5" };
  const runCap = Math.round(capSol * LAMPORTS);
  const W = { compute: process.env.COMPUTE_WALLET, buyback: process.env.BUYBACK_WALLET };
  for (const [k, v] of Object.entries(W)) if (!isAddress(v || "")) return { error: `${k.toUpperCase()}_WALLET must be set to a Solana address` };
  const coins = await db.select("coins", "confirmed=eq.true&limit=1000");
  const out = []; let sentThisRun = 0; const time = budget();
  for (const c of coins) {
    if (time.over()) { out.push({ mint: c.mint, skipped: "time_budget", note: "the next run continues from here" }); continue; }
    // a round that failed or stopped midway is never retried automatically: a person checks it first
    const stuck = await db.select("payout_rounds", `mint=${eq(c.mint)}&status=in.(sending,failed)&limit=1`);
    if (stuck.length) { out.push({ mint: c.mint, skipped: "needs_review", round: stuck[0].id }); continue; }
    const pool = Math.max(0, (await balance(c.pool_wallet)) - RENT_KEEP);
    if (!isAddress(c.creator || "")) { out.push({ mint: c.mint, skipped: "no_dev_wallet" }); continue; }
    if (!validAiPct(+c.ai_pct)) { out.push({ mint: c.mint, skipped: "bad_ai_pct" }); continue; }
    const plan = planSplit(pool, +c.ai_pct);
    if (!plan) { out.push({ mint: c.mint, pool, skipped: "under_threshold" }); continue; }
    if (plan.total > runCap) { out.push({ mint: c.mint, skipped: "pool_bigger_than_run_cap", pool: plan.total, note: "raise MAX_PAYOUT_SOL_PER_RUN to send this one" }); continue; }
    if (sentThisRun + plan.total > runCap) { out.push({ mint: c.mint, skipped: "run_cap" }); continue; }
    if (!live) { out.push({ mint: c.mint, target: c.target, dryRun: true, plan }); continue; }

    // claim the round first: the unique (mint, round_no) row makes a double send impossible
    const roundNo = c.round_no + 1;
    let round;
    try { round = (await db.insert("payout_rounds", [{ mint: c.mint, round_no: roundNo, pool_lamports: pool, plan }]))[0]; }
    catch (e) { out.push({ mint: c.mint, skipped: "round_exists" }); continue; }
    await db.update("coins", `mint=${eq(c.mint)}`, { round_no: roundNo });
    const lines = ["compute", "buyback", "dev"].map(kind => ({ to: kind === "dev" ? c.creator : W[kind], lamports: plan[kind], kind })).filter(l => l.lamports > 0);
    await db.insert("payouts", lines.map(l => ({ round_id: round.id, mint: c.mint, target: c.target, wallet: l.to, lamports: l.lamports, kind: l.kind })));
    try {
      const sigs = await sendFromPool(c.mint, lines);
      for (const { sig, batch } of sigs) for (const l of batch) {
        await db.update("payouts", `round_id=eq.${round.id}&kind=${eq(l.kind)}`, { tx: sig, status: "sent" });
        await db.insert("activity", [{ kind: l.kind, mint: c.mint, target: c.target, wallet: l.to, lamports: l.lamports, tx: sig }]);
      }
      await db.update("payout_rounds", `id=eq.${round.id}`, { status: "done", finished_at: new Date().toISOString() });
      await db.update("coins", `mint=${eq(c.mint)}`, { funded_lamports: (+c.funded_lamports || 0) + plan.compute, dev_lamports: (+c.dev_lamports || 0) + plan.dev });
      sentThisRun += plan.total;
      out.push({ mint: c.mint, sent: plan, txs: sigs.map(s => s.sig) });
    } catch (e) {
      // stop everything on the first failure; a person looks at it before anything else is sent
      await db.update("payout_rounds", `id=eq.${round.id}`, { status: "failed" });
      out.push({ mint: c.mint, error: e.message, sig: e.sig });
      break;
    }
  }
  return { live, results: out };
}

// Runs queued AI tasks. Off until ANTHROPIC_API_KEY is set. Spend is capped: WORK_PER_RUN tasks per run (default 2)
// and DAILY_TASK_CAP tasks per UTC day (default 30). A failed task is tried up to 3 times, then marked failed.
async function work() {
  if (!process.env.ANTHROPIC_API_KEY) return { disabled: true, note: "ANTHROPIC_API_KEY is not set, so tasks stay queued until the team posts a result." };
  const int = (v, d, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(max, n) : d; };
  const perRun = int(process.env.WORK_PER_RUN, 2, 10), cap = int(process.env.DAILY_TASK_CAP, 30, 1000), time = budget();
  // a task left "running" by a run that died goes back in the queue
  await db.update("tasks", `status=eq.running&started_at=lt.${new Date(Date.now() - 10 * 60e3).toISOString()}`, { status: "queued" }).catch(() => {});
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const used = (await db.select("tasks", `started_at=gte.${day.toISOString()}&source=eq.ai&select=id&limit=1000`)).length;
  const room = Math.min(perRun, cap - used);
  if (room <= 0) return { capped: true, usedToday: used, cap };
  const queued = await db.select("tasks", `status=eq.queued&order=created_at.asc&limit=${room}`);
  const results = await pmap(queued, 2, async t => {
    if (time.over()) return { id: t.id, skipped: "time_budget" };
    // take it: only one worker can move a task from queued to running
    const took = await db.update("tasks", `id=eq.${t.id}&status=eq.queued`, { status: "running", source: "ai", started_at: new Date().toISOString(), attempts: (+t.attempts || 0) + 1 });
    if (!took.length) return { id: t.id, skipped: "taken" };
    const c = (await db.select("coins", `mint=${eq(t.mint)}&select=target&limit=1`))[0];
    const names = namesFor(c && c.target);
    try {
      const a = await askModel(t, names);
      await db.update("tasks", `id=eq.${t.id}`, { status: "done", summary: a.summary, detail: a.detail, model: a.model, finished_at: new Date().toISOString() });
      await refreshDone(t.mint).catch(() => {});
      return { id: t.id, mint: t.mint, n: t.n, done: true };
    } catch (e) {
      const giveUp = (+t.attempts || 0) + 1 >= 3;
      await db.update("tasks", `id=eq.${t.id}`, { status: giveUp ? "failed" : "queued", finished_at: giveUp ? new Date().toISOString() : null }).catch(() => {});
      return { id: t.id, mint: t.mint, n: t.n, error: String(e.message || e).slice(0, 120), giveUp };
    }
  });
  return { usedToday: used + results.filter(r => r.done || r.error).length, cap, ms: time.spent(), results };
}

const JOBS = { tick, claim, work, payout };
export default guard(async (req, res) => {
  if (!cronAuthorized(req)) return send(res, 401, { error: "unauthorized" });
  const job = JOBS[String(req.query.job || "")];
  if (!job) return send(res, 404, { error: "job" });
  if (paused() && req.query.job !== "tick") return send(res, 200, { paused: true });
  send(res, 200, await job());
});
