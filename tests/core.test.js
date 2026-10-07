import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { poolWallet, opsWallet, keypairFromSeed } from "../lib/keys.js";
import { planSplit, LAMPORTS, MIN_SEND_LAMPORTS } from "../lib/payout.js";
import { validate, catalog } from "../lib/games.js";

test("split: 10% buyback off the top, dev's AI pick splits the rest, adds up to exactly the pool", () => {
  assert.equal(planSplit(0.49 * LAMPORTS, 50, 0.5 * LAMPORTS), null);
  for (const ai of [25, 50, 60, 95, 100]) for (const pool of [0.5 * LAMPORTS, 1 * LAMPORTS + 7, 3_333_333_333, 12.345678901 * LAMPORTS]) {
    const p = planSplit(pool, ai, 0.5 * LAMPORTS), P = Math.floor(pool);
    assert.equal(p.compute + p.buyback + p.dev, P);
    assert.equal(p.buyback, Math.floor(P * 0.1));
    assert.ok(Math.abs(p.compute - (P - p.buyback) * ai / 100) <= MIN_SEND_LAMPORTS);
    if (ai === 100) assert.equal(p.dev, 0); else assert.ok(p.dev >= MIN_SEND_LAMPORTS);
  }
  assert.deepEqual(planSplit(LAMPORTS, 50, 1), { compute: 450_000_000, buyback: 100_000_000, dev: 450_000_000, aiPct: 50, total: LAMPORTS });
  for (const bad of [24, 101, 50.5, NaN, undefined]) assert.equal(planSplit(LAMPORTS, bad, 1), null);
  assert.equal(planSplit(NaN, 50, 1), null);
  assert.equal(planSplit(-5, 50, 1), null);
});

test("pool wallets: per coin, need the master seed, never the same as Exposure's derivation", () => {
  const master = crypto.randomBytes(32).toString("hex"), a = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", b = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
  assert.equal(poolWallet(master, a).publicKey, poolWallet(master, a).publicKey);
  assert.notEqual(poolWallet(master, a).publicKey, poolWallet(master, b).publicKey);
  const exposureStyle = keypairFromSeed(crypto.createHmac("sha256", Buffer.from(master, "hex")).update("exposure-pool-v1:" + a).digest());
  assert.notEqual(poolWallet(master, a).publicKey, exposureStyle.publicKey);
  assert.notEqual(opsWallet(master).publicKey, poolWallet(master, a).publicKey);
  assert.throws(() => poolWallet("short", a));
});

test("games.json: the shipped file is valid, every combo points at real games", () => {
  const c = catalog();
  assert.deepEqual(c.errors, []);
  assert.ok(c.games.length > 0 && c.combos.length > 0);
  const ids = new Set(c.games.map(g => g.id));
  for (const k of c.combos) for (const g of k.games) assert.ok(ids.has(g), g);
});

test("games.json: bad entries are rejected with a readable reason, good ones kept", () => {
  const r = validate({
    games: [{ id: "ok-game", name: "Ok", platform: "N64" }, { id: "Bad Id", name: "x", platform: "N64" }, { id: "ok-game", name: "dupe", platform: "N64" }, { id: "wii-game", name: "Wii", platform: "Wii" }, { id: "two", name: "Two", platform: "PS1", stage: 9, pct: 400, repo: "javascript:alert(1)" }],
    combos: [{ id: "c1", name: "C1", games: ["ok-game", "two"] }, { id: "c2", name: "C2", games: ["ok-game"] }, { id: "c3", name: "C3", games: ["ok-game", "ghost"] }, { id: "ok-game", name: "dupe", games: ["ok-game", "two"] }]
  });
  assert.deepEqual(r.games.map(g => g.id), ["ok-game", "two"]);
  assert.equal(r.games[1].stage, 5); assert.equal(r.games[1].pct, 100); assert.equal(r.games[1].repo, "");
  assert.deepEqual(r.combos.map(c => c.id), ["ok-game+two"]);
  assert.equal(r.errors.length, 6);
});

test("each coin's website link opens its own combo page", async () => {
  const { targetUrl } = await import("../lib/games.js");
  assert.equal(targetUrl("https://console.fun/", "skate-2+skate-3"), "https://console.fun/#game-skate-2%2Bskate-3");
  assert.equal(targetUrl("", "a+b"), undefined);
});

import { parseReply, taskFor, nextAt } from "../lib/tasks.js";
test("tasks: reply parsing, titles take turns across games, next unlock", () => {
  assert.equal(parseReply(""), null);
  const r = parseReply("One line.\n\nThe notes.\n\nMore."); assert.equal(r.summary, "One line."); assert.equal(r.detail, "The notes.\n\nMore.");
  assert.equal(parseReply("x".repeat(500)).summary.length, 200);
  assert.ok(taskFor(["A", "B", "C"], 1).title.includes("A") && taskFor(["A", "B", "C"], 2).title.includes("B") && taskFor(["A", "B", "C"], 4).title.includes("A"));
  assert.notEqual(taskFor(["A", "B"], 1).title, taskFor(["A", "B"], 3).title);   // same game, next step
  assert.equal(nextAt(0), 1); assert.equal(nextAt(4), 5);
});
