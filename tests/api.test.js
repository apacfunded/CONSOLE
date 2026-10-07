// Handler tests with a fake database + RPC (global fetch is stubbed). No network, no real keys.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { keypairFromSeed } from "../lib/keys.js";

process.env.SUPABASE_URL = "https://db.test"; process.env.SUPABASE_SERVICE_KEY = "k"; process.env.SOLANA_RPC_URL = "https://rpc.test";
process.env.CRON_SECRET = "s".repeat(40); process.env.SITE_URL = "https://console.test";
process.env.POOL_MASTER_SEED = crypto.randomBytes(32).toString("hex");

const T = { coins: [], activity: [], payout_rounds: [], payouts: [], mc_history: [], burns: [], tasks: [] };
let aiFails = false, aiCalls = 0;
let targetFree = true, rpcBalance = 0, txOnChain = null;
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const json = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o, text: async () => JSON.stringify(o) });
  if (url.startsWith("https://rpc.test")) {
    const b = JSON.parse(opt.body);
    if (b.method === "getBalance") return json({ result: { value: rpcBalance } });
    if (b.method === "getLatestBlockhash") return json({ result: { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 } } });
    if (b.method === "getMultipleAccounts") return json({ result: { value: [] } });
    if (b.method === "getSignaturesForAddress") return json({ result: [] });
    if (b.method === "getTokenAccountsByOwner") return json({ result: { value: [] } });
    if (b.method === "getTransaction") return json({ result: txOnChain });
    return json({ result: { value: null } });
  }
  if (url.startsWith("https://uploads.pinata.cloud")) return json({ data: { cid: "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy" } });
  if (url.startsWith("https://db.test/rest/v1/rpc/hit_rate_limit")) return json(true);
  if (url.startsWith("https://db.test/rest/v1/rpc/insert_coin_if_free")) { const a = JSON.parse(opt.body); if (!targetFree) return json(false); T.coins.push({ mint: a.p_mint, target: a.p_target, creator: a.p_creator, ai_pct: a.p_ai_pct, confirmed: false }); return json(true); }
  if (url.startsWith("https://db.test/rest/v1/rpc/")) return json(null);
  if (url.startsWith("https://api.anthropic.com/")) { aiCalls++; return aiFails ? json({ error: "x" }, 500) : json({ content: [{ type: "text", text: "Checked the public notes on the engine.\n\nIt uses a known engine; formats are documented by the community." }] }); }
  if (url.includes("coingecko") || url.includes("dexscreener")) return json({});
  const m = url.match(/rest\/v1\/([a-z_]+)/); const t = m && m[1];
  if (opt.method === "POST") { const rows = JSON.parse(opt.body); if (t === "burns" && rows.some(r => T.burns.some(x => x.tx === r.tx))) return json({ message: "duplicate" }, 409); T[t] = T[t] || []; if (t === "tasks") { if (rows.some(r => T.tasks.some(x => x.mint === r.mint && x.n === r.n))) return json({ message: "duplicate" }, 409); rows.forEach((r, i) => { r.id = T.tasks.length + i + 1; }); } T[t].push(...rows); return json(rows, 201); }
  const filt = rows => {
    for (const [, col, val] of url.matchAll(/[?&]([a-z_]+)=eq\.([^&]+)/g)) rows = rows.filter(r => String(r[col]) === decodeURIComponent(val));
    for (const [, col, val] of url.matchAll(/[?&]([a-z_]+)=in\.\(([^)]*)\)/g)) rows = rows.filter(r => val.split(",").includes(String(r[col])));
    return rows;
  };
  if (opt.method === "PATCH" && t === "tasks") { const hit = filt(T.tasks); hit.forEach(r => Object.assign(r, JSON.parse(opt.body))); return json(hit); }
  if (opt.method === "PATCH" || opt.method === "DELETE") return json([]);
  let rows = T[t] || [];
  rows = filt(rows);
  const lim = url.match(/[?&]limit=(\d+)/); if (lim) rows = rows.slice(0, +lim[1]);
  if (/confirmed=eq\.false/.test(url)) rows = rows.filter(r => !r.confirmed);
  return json(rows);
};

function call(handler, { method = "POST", body, raw, query = {}, headers = {} }) {
  const req = Readable.from(raw ? [raw] : body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, query, headers: { host: "console.test", ...headers } });
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b ? JSON.parse(b) : null }); }, get headersSent() { return false; } };
    handler(req, res);
  });
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
async function launchForm(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("image", new Blob([PNG], { type: "image/png" }), "a.png");
  const r = new Response(fd);
  return { raw: Buffer.from(await r.arrayBuffer()), headers: { "content-type": r.headers.get("content-type") } };
}
const launcher = keypairFromSeed(crypto.randomBytes(32));

test("launch: closed until LAUNCHES_ENABLED=1", async () => {
  const { default: launch } = await import("../api/launch/index.js");
  delete process.env.LAUNCHES_ENABLED;
  assert.equal((await call(launch, { body: {} })).status, 503);
});

test("launch: only approved targets, original names, one coin per game, builds a tx the launcher pays", async () => {
  const { default: launch } = await import("../api/launch/index.js");
  process.env.LAUNCHES_ENABLED = "1"; rpcBalance = 1e9;
  const base = { name: "Kickflip Fund", ticker: "KFLIP", creator: launcher.publicKey, target: "skate-2+skate-3", aiPct: "60" };
  let r = await call(launch, await launchForm({ ...base, target: "not-a-game" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /approved list/);
  r = await call(launch, await launchForm({ ...base, name: "Skate 3 Coin" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /original name/);
  r = await call(launch, await launchForm({ ...base, name: "Skate 2 fans" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /original name/);
  r = await call(launch, await launchForm({ ...base, target: "skate-3" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /2 or 3/);
  r = await call(launch, await launchForm({ ...base, target: "skate-3+skate-2" }));
  assert.equal(r.status, 400);
  r = await call(launch, await launchForm({ ...base, target: "skate-3+skate-3" }));
  assert.equal(r.status, 400);
  r = await call(launch, await launchForm({ ...base, target: "gta-4+gta-5", name: "Grand Theft Auto V Fund" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /original name/);
  r = await call(launch, await launchForm({ ...base, aiPct: "10" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /25% and 100%/);
  r = await call(launch, await launchForm({ ...base, ticker: "TOOLONGTICKER1" }));
  assert.equal(r.status, 400);
  r = await call(launch, { ...(await launchForm(base)), headers: { ...(await launchForm(base)).headers, origin: "https://evil.test" } });
  assert.equal(r.status, 403);
  rpcBalance = 1000; r = await call(launch, await launchForm(base)); assert.equal(r.status, 400); assert.match(r.body.error, /needs about/); rpcBalance = 1e9;
  r = await call(launch, await launchForm(base));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.tx && r.body.mint);
  assert.equal(T.coins.at(-1).target, "skate-2+skate-3");
  r = await call(launch, await launchForm({ ...base, target: "gta-5+minecraft", name: "Block Fund", ticker: "BLOK" }));
  assert.equal(r.status, 429); assert.match(r.body.error, /already have a launch in progress/);
  targetFree = false;
  const other = keypairFromSeed(crypto.randomBytes(32)).publicKey;
  r = await call(launch, await launchForm({ ...base, creator: other }));
  assert.equal(r.status, 409); assert.match(r.body.error, /already has a coin/);
  targetFree = true;
});

test("confirm: refuses junk and other creators", async () => {
  const { default: confirm } = await import("../api/launch/confirm.js");
  assert.equal((await call(confirm, { body: { mint: "x" } })).status, 400);
  const mint = T.coins.at(-1).mint;
  const other = keypairFromSeed(crypto.randomBytes(32)).publicKey;
  assert.equal((await call(confirm, { body: { mint, creator: other, signature: "5".repeat(88) } })).status, 403);
});

test("state: lists every game and combo with its coin (or none)", async () => {
  const { default: state } = await import("../api/state.js");
  T.coins.push({ mint: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", target: "gta-4+gta-5", ticker: "DRFT", name: "Drift Fund", confirmed: true, ai_pct: 60, creator: keypairFromSeed(crypto.randomBytes(32)).publicKey, pool_wallet: keypairFromSeed(crypto.randomBytes(32)).publicKey, pool_lamports: 5e8, funded_lamports: 2e9, mc: 1000, round_no: 0 });
  const r = await call(state, { method: "GET" });
  assert.equal(r.status, 200);
  for (const k of ["games", "combos", "totals", "activity", "launchesOpen", "split"]) assert.ok(k in r.body, k);
  assert.equal(r.body.games.find(g => g.id === "gta-4").combos, 1);
  assert.equal(r.body.combos[0].id, "gta-4+gta-5"); assert.ok(r.body.combos[0].coin);
  assert.ok(r.body.combos.some(c => c.suggested && !c.coin));
  assert.equal(r.body.combos[0].kind, "combo");
});

test("wallet: rejects junk addresses, answers real ones", async () => {
  const { default: w } = await import("../api/wallet/[addr].js");
  assert.equal((await call(w, { method: "GET", query: { addr: "<script>" } })).status, 400);
  assert.equal((await call(w, { method: "GET", query: { addr: launcher.publicKey } })).status, 200);
});

test("cron: refuses without the secret; payout refuses without wallets; dry run by default", async () => {
  const { default: cron } = await import("../api/cron/[job].js");
  const auth = { authorization: "Bearer " + "s".repeat(40) };
  assert.equal((await call(cron, { method: "GET", query: { job: "tick" } })).status, 401);
  assert.equal((await call(cron, { method: "GET", query: { job: "nope" }, headers: auth })).status, 404);
  let r = await call(cron, { method: "GET", query: { job: "payout" }, headers: auth });
  assert.match(r.body.error, /COMPUTE_WALLET/);
  process.env.COMPUTE_WALLET = keypairFromSeed(crypto.randomBytes(32)).publicKey;
  process.env.BUYBACK_WALLET = keypairFromSeed(crypto.randomBytes(32)).publicKey;
  rpcBalance = 2e9;
  r = await call(cron, { method: "GET", query: { job: "payout" }, headers: auth });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.live, false);
  const dry = r.body.results.find(x => x.dryRun);
  assert.ok(dry); const P = 2e9 - 2_000_000; assert.equal(dry.plan.compute + dry.plan.buyback + dry.plan.dev, P);
  assert.equal(dry.plan.buyback, Math.floor(P * 0.1)); assert.equal(dry.plan.compute, Math.floor((P - dry.plan.buyback) * 0.6));
  assert.equal(T.payout_rounds.length, 0);
});

test("burn: owner only, checks the transaction on chain, never records twice, shows up in state", async () => {
  const { default: burn } = await import("../api/admin/burn.js");
  const { default: state } = await import("../api/state.js");
  const auth = { authorization: "Bearer " + process.env.CRON_SECRET };
  process.env.BUYBACK_WALLET = process.env.BUYBACK_WALLET || keypairFromSeed(crypto.randomBytes(32)).publicKey;
  const sig = "4".repeat(88);
  assert.equal((await call(burn, { body: { tx: sig, tokens: 10 } })).status, 401);
  assert.equal((await call(burn, { body: { tx: "nope", tokens: 10 }, headers: auth })).status, 400);
  assert.equal((await call(burn, { body: { tx: sig, tokens: 0 }, headers: auth })).status, 400);
  txOnChain = null;
  assert.equal((await call(burn, { body: { tx: sig, tokens: 10 }, headers: auth })).status, 404);
  txOnChain = { meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: "SomeoneElse1111111111111111111111111111111" }] } } };
  let r = await call(burn, { body: { tx: sig, tokens: 10 }, headers: auth });
  assert.equal(r.status, 400); assert.match(r.body.error, /buyback wallet/);
  txOnChain = { meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: process.env.BUYBACK_WALLET }] } } };
  r = await call(burn, { body: { tx: sig, tokens: 1_000_000, sol: 0.25, note: "first burn" }, headers: auth });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call(burn, { body: { tx: sig, tokens: 1_000_000 }, headers: auth })).status, 409);
  assert.ok(T.activity.some(a => a.kind === "burn" && a.tx === sig));
  const st = await call(state, { method: "GET" });
  assert.equal(st.body.totals.burnedTokens, 1_000_000);
  assert.equal(st.body.burns[0].tx, sig);
});

test("cron claim: works in pages, oldest-claimed first, and reports what it looked at", async () => {
  const { default: cron } = await import("../api/cron/[job].js");
  const auth = { authorization: "Bearer " + process.env.CRON_SECRET };
  process.env.CLAIM_PAGE_SIZE = "1";
  const r = await call(cron, { method: "GET", query: { job: "claim" }, headers: auth });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.page, 1);
  assert.ok(r.body.coins >= 1);
  assert.ok(r.body.looked_at <= r.body.page);
  assert.ok(Array.isArray(r.body.results));
  delete process.env.CLAIM_PAGE_SIZE;
});

test("batch helpers: pmap caps concurrency and keeps order; budget stops a loop", async () => {
  const { pmap, budget } = await import("../lib/batch.js");
  let inFlight = 0, peak = 0;
  const out = await pmap([1, 2, 3, 4, 5, 6], 2, async n => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; if (n === 4) throw new Error("boom"); return n * 10; });
  assert.deepEqual(out.slice(0, 3), [10, 20, 30]); assert.equal(out[3].error, "boom"); assert.equal(out[5], 60);
  assert.equal(peak, 2);
  const t = budget(1); await new Promise(r => setTimeout(r, 5)); assert.equal(t.over(), true);
});

test("tasks: one unlocks per 1 SOL of estimated volume, never twice, and only for the volume earned", async () => {
  const { unlockTasks, volumeSol, tasksDue } = await import("../lib/tasks.js");
  const mint = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  T.tasks.length = 0;   // tasks made by earlier tests (the claim test) are not part of this one
  T.coins.push({ mint, target: "skate-2+skate-3", confirmed: true, tasks_unlocked: 0, fees_lamports: 0.009 * 1e9, fees_waiting_lamports: 0 });
  const c = T.coins.at(-1);
  assert.ok(Math.abs(volumeSol(c) - 3) < 1e-6);                     // 0.009 SOL of fees at 0.30% = 3 SOL of volume
  assert.equal(tasksDue(2.999), 2); assert.equal(tasksDue(3), 3);
  let r = await unlockTasks(c); assert.equal(r.unlocked, 3);
  assert.deepEqual(T.tasks.filter(t => t.mint === mint).map(t => t.n), [1, 2, 3]);
  assert.ok(/Skate 2/.test(T.tasks[0].title) && /Skate 3/.test(T.tasks[1].title), JSON.stringify(T.tasks.map(t => t.title)));   // games take turns
  c.tasks_unlocked = 3; r = await unlockTasks(c); assert.equal(r.unlocked, 0);               // nothing new earned
  c.tasks_unlocked = 0; r = await unlockTasks(c); assert.equal(r.unlocked, 0);               // already exist: no duplicates
  assert.equal(T.tasks.filter(t => t.mint === mint).length, 3);
  c.tasks_unlocked = 3;   // what the database now holds after the first unlock
});

test("work: off without a key; with a key it runs queued tasks, capped, and retries then gives up", async () => {
  const { default: cron } = await import("../api/cron/[job].js");
  const auth = { authorization: "Bearer " + process.env.CRON_SECRET };
  delete process.env.ANTHROPIC_API_KEY;
  let r = await call(cron, { method: "GET", query: { job: "work" }, headers: auth });
  assert.equal(r.body.disabled, true); assert.equal(aiCalls, 0); assert.ok(T.tasks.every(t => t.status === "queued"));
  process.env.ANTHROPIC_API_KEY = "k"; process.env.WORK_PER_RUN = "2";
  r = await call(cron, { method: "GET", query: { job: "work" }, headers: auth });
  assert.equal(r.body.results.filter(x => x.done).length, 2); assert.equal(aiCalls, 2);
  const done = T.tasks.filter(t => t.status === "done");
  assert.equal(done.length, 2); assert.equal(done[0].source, "ai"); assert.match(done[0].summary, /public notes/); assert.match(done[0].detail, /community/);
  process.env.DAILY_TASK_CAP = "2";
  r = await call(cron, { method: "GET", query: { job: "work" }, headers: auth });
  assert.equal(r.body.capped, true); assert.equal(aiCalls, 2);           // daily cap holds
  process.env.DAILY_TASK_CAP = "30"; aiFails = true;
  for (let i = 0; i < 3; i++) await call(cron, { method: "GET", query: { job: "work" }, headers: auth });
  assert.equal(T.tasks.find(t => t.n === 3).status, "failed");            // third failure: stop trying
  aiFails = false; delete process.env.ANTHROPIC_API_KEY;
});

test("admin task: owner only; posts a result by hand; unlocked tasks only", async () => {
  const { default: post } = await import("../api/admin/task.js");
  const mint = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", auth = { authorization: "Bearer " + process.env.CRON_SECRET };
  assert.equal((await call(post, { body: { mint, summary: "x" } })).status, 401);
  assert.equal((await call(post, { body: { mint: "nope", summary: "x" }, headers: auth })).status, 400);
  assert.equal((await call(post, { body: { mint, n: 9, summary: "x" }, headers: auth })).status, 404);   // task 9 hasn't unlocked
  assert.equal((await call(post, { body: { mint, status: "done" }, headers: auth })).status, 400);       // needs a summary
  const r = await call(post, { body: { mint, n: 3, summary: "Did it by hand.", detail: "notes" }, headers: auth });
  assert.equal(r.status, 200); const t = T.tasks.find(x => x.n === 3 && x.mint === mint);
  assert.equal(t.status, "done"); assert.equal(t.source, "team");
});

test("tasks feed + state: public, read-only, shows counts and the next unlock", async () => {
  const { default: feed } = await import("../api/tasks.js");
  const { default: state } = await import("../api/state.js");
  const mint = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  assert.equal((await call(feed, { method: "GET", query: { mint: "bad" } })).status, 400);
  assert.equal((await call(feed, { method: "POST", query: { mint } })).status, 405);
  const r = await call(feed, { method: "GET", query: { mint } });
  assert.equal(r.status, 200); assert.equal(r.body.tasks.length, 3); assert.ok(r.body.tasks.some(t => t.status === "done"));
  const s = await call(state, { method: "GET" });
  const coin = s.body.combos.find(c => c.id === "skate-2+skate-3").coin;
  assert.equal(s.body.taskEverySol, 1); assert.ok(coin.vol >= 3 && coin.tasks.unlocked === 3 && coin.tasks.next === 4);
});
