// Builds the JSON the site reads (GET /api/state and /api/wallet/:addr).
import { db, eq } from "./db.js";
import { rpc } from "./rpc.js";
import { LAMPORTS, SPLIT, thresholdLamports } from "./payout.js";
import { catalog } from "./games.js";
import { volumeSol, everySol, nextAt, tasksDue } from "./tasks.js";

const imgUrl = u => { const m = String(u || "").match(/\/ipfs\/([A-Za-z0-9]+)/); return m ? `${(process.env.SITE_URL || "").replace(/\/$/, "")}/api/img?cid=${m[1]}` : ""; };
const ms = t => (t ? Date.parse(t) : 0);
const sol = l => +((+l || 0) / LAMPORTS).toFixed(4);
const coinOut = c => c && { mint: c.mint, t: c.ticker, n: c.name, img: imgUrl(c.img), mc: +c.mc || 0, pool: sol(c.pool_lamports), funded: sol(c.funded_lamports), dev: sol(c.dev_lamports), aiPct: +c.ai_pct || 100, vol: +volumeSol(c).toFixed(2), tasks: { unlocked: +c.tasks_unlocked || 0, done: +c.tasks_done || 0, next: nextAt(Math.max(+c.tasks_unlocked || 0, tasksDue(volumeSol(c)))) }, creator: c.creator, createdAt: ms(c.created_at) };

export async function buildState() {
  const { games, combos } = catalog();
  const [coins, act, buybackRows, burns] = await Promise.all([
    db.select("coins", "confirmed=eq.true&order=created_at.desc&limit=1000"),
    db.select("activity", "order=at.desc&limit=60"),
    db.select("payouts", "kind=eq.buyback&status=eq.sent&select=lamports&limit=10000").catch(() => []),
    db.select("burns", "order=at.desc&limit=200").catch(() => [])
  ]);
  const byTarget = new Map(coins.map(c => [c.target, c]));
  const [solUsd] = await Promise.all([
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd").then(r => r.json()).then(j => +j.solana.usd || 0).catch(() => 0)
  ]);
  const sent = k => sol(act.filter(a => a.kind === k).reduce((s, a) => s + (+a.lamports || 0), 0));
  return {
    launchesOpen: process.env.LAUNCHES_ENABLED === "1" && process.env.PAUSED !== "1",
    taskEverySol: everySol(), workerOn: !!process.env.ANTHROPIC_API_KEY,
    split: SPLIT, thresholdSol: thresholdLamports() / LAMPORTS,
    games: games.map(g => ({ ...g, kind: "game", combos: coins.filter(c => String(c.target).split("+").includes(g.id)).length })),
    combos: [
      // live combos first (any set of games someone launched), then suggested ones still waiting for a coin
      ...coins.map(c => { const keys = String(c.target).split("+"), sug = combos.find(x => x.id === c.target); return { id: c.target, kind: "combo", games: keys, name: sug ? sug.name : keys.map(k => (games.find(g => g.id === k) || { name: k }).name).join(" x "), idea: sug ? sug.idea : String(c.description || "").slice(0, 160), suggested: !!sug, coin: coinOut(c) }; }),
      ...combos.filter(c => c.open && !byTarget.has(c.id)).map(c => ({ ...c, kind: "combo", suggested: true, coin: null }))
    ],
    totals: {
      coins: coins.length,
      funded: sol(coins.reduce((s, c) => s + (+c.funded_lamports || 0), 0)),
      waiting: sol(coins.reduce((s, c) => s + (+c.pool_lamports || 0), 0)),
      dev: sol(coins.reduce((s, c) => s + (+c.dev_lamports || 0), 0)),
      buyback: sol((buybackRows || []).reduce((s, r) => s + (+r.lamports || 0), 0)),
      burnedTokens: (burns || []).reduce((s, b) => s + (+b.tokens || 0), 0),
      burnedSol: sol((burns || []).reduce((s, b) => s + (+b.sol_lamports || 0), 0))
    },
    burns: (burns || []).slice(0, 50).map(b => ({ tx: b.tx, tokens: +b.tokens || 0, sol: sol(b.sol_lamports), note: b.note || "", at: ms(b.at) })),
    lastClaimAt: ms((act.find(a => a.kind === "claim") || {}).at),
    wallets: { compute: process.env.COMPUTE_WALLET || "", buyback: process.env.BUYBACK_WALLET || "" },
    activity: act.slice(0, 40).map(a => ({ kind: a.kind, target: a.target || "", mint: a.mint || "", sol: sol(a.lamports), tx: a.tx || "", at: ms(a.at) })),
    recent: { compute: sent("compute"), buyback: sent("buyback"), dev: sent("dev") },
    solUsd
  };
}

// Coins this wallet launched, and how much of each Console coin it holds (pump.fun coins are Token-2022).
export async function buildWallet(w) {
  const [mine, all] = await Promise.all([
    db.select("coins", `creator=${eq(w)}&confirmed=eq.true&order=created_at.desc&limit=100`),
    db.select("coins", "confirmed=eq.true&select=mint,target,ticker,name,mc&limit=1000")
  ]);
  const byMint = new Map(all.map(c => [c.mint, c]));
  let holdings = [];
  try {
    const res = await rpc("getTokenAccountsByOwner", [w, { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const sum = new Map();
    for (const a of res.value || []) { const i = a.account.data.parsed.info; if (byMint.has(i.mint)) sum.set(i.mint, (sum.get(i.mint) || 0) + (+i.tokenAmount.uiAmount || 0)); }
    holdings = [...sum.entries()].filter(([, n]) => n > 0).map(([m, n]) => { const c = byMint.get(m); return { mint: m, t: c.ticker, n: c.name, target: c.target, tokens: n, pct: +(n / 1e9 * 100).toFixed(4), usd: +(n / 1e9 * (+c.mc || 0)).toFixed(2) }; });
  } catch { holdings = null; }
  return { launched: mine.map(c => ({ ...coinOut(c), target: c.target })), holdings };
}
