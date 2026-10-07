// AI work tasks. Every EVERY_SOL of trading volume on a coin unlocks one task for its games. A worker (the
// "work" cron job) runs queued tasks with an AI model and posts what came back; the owner can also post a
// result by hand (api/admin/task). Nothing here pretends: a task is "queued" until something has really run it.
//
// Volume: pump.fun doesn't hand us a running volume total, so it is estimated from the creator fees the claim
// job has collected: volume = fees / fee rate. Set CREATOR_FEE_BPS to pump.fun's current creator fee in basis
// points (30 = 0.30%) and the estimate follows it.
import { db, eq } from "./db.js";
import { LAMPORTS } from "./payout.js";
import { catalog } from "./games.js";

const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
export const everySol = () => num(process.env.TASK_EVERY_SOL, 1);
export const feeBps = () => num(process.env.CREATOR_FEE_BPS, 30);
export const MAX_NEW_PER_RUN = 20;

// Estimated lifetime trading volume in SOL from the fees claimed so far plus fees still waiting in pump.fun's vaults.
export function volumeSol(coin) {
  const fees = ((+coin.fees_lamports || 0) + (+coin.fees_waiting_lamports || 0)) / LAMPORTS;
  return fees / (feeBps() / 10_000);
}
export const tasksDue = (vol, every = everySol()) => Math.max(0, Math.floor(vol / every + 1e-9));
// SOL of volume at which the next task unlocks (given how many are unlocked now).
export const nextAt = (unlocked, every = everySol()) => +((unlocked + 1) * every).toFixed(4);

// The work, in order. Each game in a combo takes turns; once the list runs out it starts a new round.
const STEPS = [
  ["Map {g}: engine, file formats and tools", "What engine or toolchain {g} was built with, how its files are organised, and which public tools and community notes already exist for it."],
  ["Outline {g}'s asset formats", "How models, textures, audio and level data are stored, and what a reader for each format would need."],
  ["Plan how to split {g}'s code into functions", "A plan for finding function boundaries, naming conventions for labelled code, and the order to work through it."],
  ["Draft the matching plan for {g}", "How a rewritten function will be checked against the original: compiler, flags, and the byte-for-byte test."],
  ["List the systems {g} needs to run on PC", "Rendering, input, audio, saving and timing: what has to be replaced to run natively, and the order to do it."],
  ["Draft the mod-loader design for {g}", "Where a mod loader would hook in, what it exposes, and how mods are packaged."],
  ["Risks and gaps for {g}", "What is hard, what is unknown, and what the work depends on that nobody has verified yet."],
  ["Write the player guide for {g}", "What a player needs to bring (their own copy), how to build, and how to report problems."]
];
export function taskFor(names, n) {
  const list = names.length ? names : ["the game"];
  const i = n - 1, g = list[i % list.length], k = Math.floor(i / list.length);
  const [title, brief] = STEPS[k % STEPS.length];
  const round = Math.floor(k / STEPS.length);
  return { title: title.replace(/\{g\}/g, g) + (round ? ` (round ${round + 1})` : ""), brief: brief.replace(/\{g\}/g, g), game: g };
}

export function namesFor(target) {
  const { games } = catalog();
  return String(target || "").split("+").map(id => (games.find(g => g.id === id) || { name: id }).name);
}

// Creates the task rows a coin has earned and not got yet. Safe to run repeatedly: (mint, n) is unique.
export async function unlockTasks(coin) {
  const due = tasksDue(volumeSol(coin)), have = +coin.tasks_unlocked || 0;
  if (due <= have) return { unlocked: 0, due };
  const upTo = Math.min(due, have + MAX_NEW_PER_RUN), names = namesFor(coin.target);
  let made = 0;
  for (let n = have + 1; n <= upTo; n++) {
    const t = taskFor(names, n);
    try { await db.insert("tasks", [{ mint: coin.mint, n, title: t.title, brief: t.brief, status: "queued", vol_sol: +(n * everySol()).toFixed(4) }]); made++; }
    catch (e) { if (e.status !== 409) throw e; }
  }
  await db.update("coins", `mint=${eq(coin.mint)}`, { tasks_unlocked: upTo });
  return { unlocked: made, due };
}

export async function refreshDone(mint) {
  const done = await db.select("tasks", `mint=${eq(mint)}&status=eq.done&select=n&limit=1000`);
  await db.update("coins", `mint=${eq(mint)}`, { tasks_done: done.length });
  return done.length;
}

// ---- the AI worker ----
export const SYSTEM = `You are the Console build assistant. Console is a launchpad where a coin's trading fees pay for AI to work on reverse engineering classic games so people can mod and play them on PC.
You are given ONE task. In this run you have no access to any game's files, binaries or tools, so you work only from well-known public knowledge: engines, file formats, community documentation, general reverse-engineering practice.
Rules: say plainly when you are unsure or don't know. Never claim you decompiled, matched, ran or tested anything. Never reproduce game code, assets or long quotes. Do not invent function names, addresses or tool output.
Reply format: the first line is a one-sentence summary (at most 160 characters). Then a blank line. Then the notes, under 350 words, as short paragraphs or a short list.`;

export function parseReply(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const [first, ...rest] = t.split(/\n\s*\n/);
  const summary = first.replace(/\s+/g, " ").slice(0, 200);
  return { summary, detail: (rest.join("\n\n") || "").slice(0, 4000) };
}

export async function askModel(task, names, { fetchImpl = fetch, timeoutMs = 45_000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.TASK_MODEL || "claude-sonnet-5-5";
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM, messages: [{ role: "user", content: `Games in this combo: ${names.join(", ")}\nTask: ${task.title}\nWhat is wanted: ${task.brief}` }] })
  });
  if (!r.ok) throw new Error(`model ${r.status}`);
  const j = await r.json();
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const out = parseReply(text);
  if (!out) throw new Error("empty reply");
  return { ...out, model };
}
