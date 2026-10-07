"use strict";
// Console site. Reads GET /api/state, launches through POST /api/launch with the user's own wallet.
// Example mode (window.CONSOLE_DEMO = true) shows sample data for previews; the live site never shows it.
const CONFIG = { api: "/api", demo: window.CONSOLE_DEMO === true || window.CONSOLE_DEMO === "empty", empty: window.CONSOLE_DEMO === "empty", refreshMs: 20000 };

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => (Number.isFinite(+v) ? +v : 0);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isAddr = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v || "");
const shortW = w => (w ? w.slice(0, 4) + "…" + w.slice(-4) : "");
const fmtMC = n => (n = num(n)) >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n > 0 ? "$" + Math.max(1, Math.round(n / 1e3)) + "K" : "—";
const fmtSol = n => (num(n) === 0 ? "0" : num(n).toFixed(num(n) >= 10 ? 1 : num(n) >= 1 ? 2 : 3)) + " SOL";
const safeImg = u => { u = String(u || ""); return /^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/api\/img\?cid=[A-Za-z0-9]+$/.test(u) ? u : ""; };
const ago = t => { const s = Math.max(0, (Date.now() - num(t)) / 1000); return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"; };

const PLAT = { N64: { c: "var(--n64)", l: "N64" }, PS1: { c: "var(--ps1)", l: "PS1" }, GBA: { c: "var(--gba)", l: "GBA" }, PS2: { c: "var(--ps2)", l: "PS2" }, PS3: { c: "var(--ps3)", l: "PS3" }, PS4: { c: "var(--ps4)", l: "PS4" }, X360: { c: "var(--x360)", l: "Xbox 360" }, PC: { c: "var(--pc)", l: "PC" } };
const plat = p => PLAT[p] || { c: "var(--muted)", l: String(p || "—") };
const STAGES = [
  { t: "Map the game", d: "Find the code, the data and the tools the game was built with.", u: "a public map of the game file" },
  { t: "Label the code", d: "Split the code into functions and name what each one does.", u: "a searchable function list" },
  { t: "Rewrite the code", d: "Rewrite every function in C. It only counts when it compiles to the exact same bytes.", u: "a native PC build", q: true },
  { t: "Native port", d: "Build the game to run on PC from the player's own copy.", u: "mod support and combos" },
  { t: "Mod support", d: "Ship a mod loader and docs so anyone can change the game.", u: "community mods" }
];
const si = g => Math.min(4, Math.max(0, num(g.stage) - 1));        // 0-based stage index
const overall = g => ((si(g) + Math.min(100, num(g.pct)) / 100) / 5) * 100;

// ---------- state ----------
let S = { games: [], combos: [], totals: {}, activity: [], recent: {}, wallets: {}, launchesOpen: false, thresholdSol: 0.5 };
const targets = () => [...S.games, ...S.combos];
const byId = id => targets().find(t => t.id === id);
const gamesOf = c => (c.games || []).map(id => S.games.find(g => g.id === id)).filter(Boolean);
const coinByMint = m => targets().find(t => t.coin && t.coin.mint === m);

const comboKey = ids => [...new Set(ids)].sort().join("+");
// Preview data, built from games.json (window.CONSOLE_GAMES). Example mode adds a few made-up combo coins.
function demoState() {
  const raw = window.CONSOLE_GAMES || { games: [], combos: [] }, now = Date.now(), H = 36e5;
  const games = (raw.games || []).map(g => ({ ...g, kind: "game", combos: 0 }));
  const combos = (raw.combos || []).map(c => ({ id: comboKey(c.games), name: c.name, games: comboKey(c.games).split("+"), idea: c.idea || "", open: c.open !== false, kind: "combo", suggested: true, coin: null }));
  const st = { demo: true, taskEverySol: 1, workerOn: true, launchesOpen: false, thresholdSol: .5, games, combos, activity: [], totals: { coins: 0, funded: 0, waiting: 0, dev: 0, buyback: 0, burnedTokens: 0, burnedSol: 0 }, recent: { compute: 0, buyback: 0, dev: 0 }, burns: [], lastClaimAt: 0, wallets: {}, solUsd: 150 };
  if (CONFIG.empty || games.length < 7) return st;
  const mint = t => ("Ex4mp1e" + t + "C0nso1e").padEnd(43, "x").slice(0, 43);
  const own = { id: comboKey([games[4].id, games[6].id]), name: games[4].name + " x " + games[6].name, games: comboKey([games[4].id, games[6].id]).split("+"), idea: "A launcher's own pick.", open: true, kind: "combo", suggested: false, coin: null };
  combos.unshift(own);
  [[combos[1], "TWOC", "Two Cities", 142000, 3.2, 100], [combos[2], "KFLP", "Kickflip Club", 88000, 1.9, 60], [own, "BLOK", "Block Skaters", 41000, .6, 25]].forEach(([c, t, n, mc, f, ai], i) => { if (c) c.coin = { mint: mint(t), t, n, img: "", mc, funded: f, aiPct: ai, dev: +(f * (100 - ai) / ai).toFixed(2), pool: .31, creator: "", createdAt: now - (i + 1) * 20 * H, vol: [7.4, 4.2, 1.6][i], tasks: { unlocked: [7, 4, 1][i], done: [6, 3, 0][i], next: [8, 5, 2][i] } }; });
  const live = combos.filter(c => c.coin);
  games.forEach(g => g.combos = live.filter(c => c.games.includes(g.id)).length);
  st.activity = live.flatMap((c, i) => [{ kind: "compute", target: c.id, mint: c.coin.mint, sol: +(c.coin.funded / 4).toFixed(2), tx: "", at: now - (i + 1) * 2 * H }, { kind: "claim", target: c.id, mint: c.coin.mint, sol: .42, tx: "", at: now - (i + 1) * 3 * H }, { kind: "launch", target: c.id, mint: c.coin.mint, sol: 0, tx: "", at: c.coin.createdAt }]).sort((a, b) => b.at - a.at);
  st.totals = { coins: live.length, funded: 5.7, waiting: .93, dev: 2.07, buyback: .86, burnedTokens: 1250000, burnedSol: .61 }; st.recent = { compute: 5.7, buyback: .86, dev: 2.07 };
  st.burns = [{ tx: "", tokens: 800000, sol: .4, note: "Example burn", at: now - 30 * H }, { tx: "", tokens: 450000, sol: .21, note: "Example burn", at: now - 80 * H }];
  st.lastClaimAt = now - 3 * H;
  return st;
}

function sanitize(j) {
  const coin = c => c && isAddr(c.mint) ? { mint: c.mint, t: String(c.t || "").slice(0, 12), n: String(c.n || "").slice(0, 40), img: safeImg(c.img), mc: num(c.mc), funded: num(c.funded), dev: num(c.dev), aiPct: Math.min(100, Math.max(25, Math.round(num(c.aiPct)) || 100)), pool: num(c.pool), vol: num(c.vol), tasks: { unlocked: num(c.tasks && c.tasks.unlocked), done: num(c.tasks && c.tasks.done), next: num(c.tasks && c.tasks.next) || 1 }, creator: isAddr(c.creator) ? c.creator : "", createdAt: num(c.createdAt) } : null;
  const game = g => ({ id: String(g.id), name: String(g.name).slice(0, 48), platform: String(g.platform), icon: ICONS[g.icon] ? g.icon : "pad", stage: num(g.stage) || 1, pct: num(g.pct), functions: num(g.functions), repo: /^https:\/\/github\.com\//.test(g.repo || "") ? g.repo : "", open: g.open !== false, kind: "game", combos: num(g.combos), coin: null });
  const combo = c => ({ id: String(c.id), name: String(c.name).slice(0, 120), games: (c.games || []).map(String), idea: String(c.idea || "").slice(0, 160), open: c.open !== false, kind: "combo", suggested: !!c.suggested, coin: coin(c.coin) });
  return {
    launchesOpen: j.launchesOpen === true, thresholdSol: num(j.thresholdSol) || .5, taskEverySol: num(j.taskEverySol) || 1, workerOn: j.workerOn === true,
    games: (j.games || []).map(game), combos: (j.combos || []).map(combo),
    totals: { coins: num(j.totals && j.totals.coins), funded: num(j.totals && j.totals.funded), waiting: num(j.totals && j.totals.waiting), dev: num(j.totals && j.totals.dev), buyback: num(j.totals && j.totals.buyback), burnedTokens: num(j.totals && j.totals.burnedTokens), burnedSol: num(j.totals && j.totals.burnedSol) },
    burns: (j.burns || []).slice(0, 50).map(b => ({ tx: /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(b.tx || "") ? b.tx : "", tokens: num(b.tokens), sol: num(b.sol), note: String(b.note || "").slice(0, 160), at: num(b.at) })),
    lastClaimAt: num(j.lastClaimAt),
    recent: { compute: num(j.recent && j.recent.compute), buyback: num(j.recent && j.recent.buyback), dev: num(j.recent && j.recent.dev) },
    wallets: Object.fromEntries(["compute", "buyback"].map(k => [k, isAddr(j.wallets && j.wallets[k]) ? j.wallets[k] : ""])),
    activity: (j.activity || []).slice(0, 60).map(a => ({ kind: String(a.kind), target: String(a.target || ""), mint: isAddr(a.mint) ? a.mint : "", sol: num(a.sol), tx: /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(a.tx || "") ? a.tx : "", at: num(a.at) }))
  };
}

let loadErr = false;
async function loadState() {
  if (CONFIG.demo) {
    S = demoState();
    if (CONFIG.empty) S.empty = true; // launch day: nothing launched yet
    renderAll(); return;
  }
  try {
    const r = await fetch(CONFIG.api + "/state", { cache: "no-store" });
    if (!r.ok) throw new Error("state " + r.status);
    S = sanitize(await r.json()); loadErr = false;
  } catch (e) { loadErr = true; }
  renderAll();
}

// ---------- pieces ----------
function meter(g, lg) {
  const s = si(g), p = Math.min(100, num(g.pct));
  return `<div class="meter${lg ? " lg" : ""}" role="img" aria-label="Stage ${s + 1} of 5, ${p}% through">` + STAGES.map((_, i) => i < s ? '<i class="done"></i>' : i === s ? `<i class="cur" style="--p:${p}%"></i>` : "<i></i>").join("") + "</div>";
}
function statusOf(t) {
  if (t.kind === "game") return t.combos ? ["s-active", `In ${t.combos} combo${t.combos > 1 ? "s" : ""}`] : ["s-open", "Open to combine"];
  return t.coin ? ["s-active", "Active"] : ["s-open", "Open to launch"];
}
function comboReady(c) { const gs = gamesOf(c); return { ready: gs.filter(g => si(g) >= 3).length, of: gs.length }; }

// Original sticker icons for game cards (not the games' real logos). games.json picks one with "icon".
const ICONS = {"web": "<path d=\"M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1\"/><path d=\"M12 6.5l3.9 1.6 1.6 3.9-1.6 3.9-3.9 1.6-3.9-1.6L6.5 12l1.6-3.9z\"/>", "burst": "<path d=\"M12 2l2.6 6.4L21 6l-3.4 6 3.4 6-6.4-2.4L12 22l-2.6-6.4L3 18l3.4-6L3 6l6.4 2.4z\"/>", "palm": "<path d=\"M12.5 22c0-5 0-9 .8-12.5\"/><path d=\"M13.3 9.5C11 6.5 7 6 4 8c3.2-.2 6.4.4 9.3 1.5zM13.3 9.5c2-3 6-3.8 8.5-1.5-3-.4-6 .2-8.5 1.5zM13.3 9.5c-.3-3.2-2-6-5-7 2 2 3.6 4.6 5 7z\"/><path d=\"M5 22h15\"/>", "skyline": "<path d=\"M3 21V11h4v10M7 21V4h5v17M12 21V8h4v13M16 21v-8h5v8M2 21h20M9 8h1M9 12h1M9 16h1\"/>", "cube": "<path d=\"M12 2l9 5v10l-9 5-9-5V7z\"/><path d=\"M3 7l9 5 9-5M12 12v10\"/>", "blades": "<path d=\"M4 3l10.5 10.5M13 15.5l2.5-2.5M16 16l4 4M14.5 17.5l3-3\"/><path d=\"M20 3L9.5 13.5M11 15.5 8.5 13M8 16l-4 4M9.5 17.5l-3-3\"/>", "deck": "<rect x=\"2.5\" y=\"8\" width=\"19\" height=\"6\" rx=\"3\"/><circle cx=\"7\" cy=\"17.5\" r=\"1.8\"/><circle cx=\"17\" cy=\"17.5\" r=\"1.8\"/>", "ramp": "<path d=\"M2 5v6a5 5 0 005 5h10a5 5 0 005-5V5\"/><path d=\"M2 20h20M6 16v4M18 16v4\"/>", "spray": "<rect x=\"6\" y=\"9\" width=\"9\" height=\"12.5\" rx=\"2\"/><path d=\"M8.5 9V5.5h4V9M15 4.5h1.2M18 3h1.2M18 6.5h1.2M20.5 4.8h1\"/><path d=\"M6 14h9\"/>", "star": "<path d=\"M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z\"/>", "crosshair": "<circle cx=\"12\" cy=\"12\" r=\"8\"/><circle cx=\"12\" cy=\"12\" r=\"1.2\"/><path d=\"M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5\"/>", "goggles": "<circle cx=\"7.5\" cy=\"13.5\" r=\"3.5\"/><circle cx=\"16.5\" cy=\"13.5\" r=\"3.5\"/><path d=\"M11 13.5h2M4 13.5H2M22 13.5h-2M7.5 10V5M16.5 10V5M6 5h3M15 5h3\"/>", "tag": "<rect x=\"6\" y=\"5\" width=\"12\" height=\"16.5\" rx=\"4\"/><circle cx=\"12\" cy=\"8.6\" r=\"1\"/><path d=\"M12 1.5V4M9 13h6M9 16.5h4\"/>", "moon": "<path d=\"M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z\"/><path d=\"M17 3v3M15.5 4.5h3\"/>", "pow": "<path d=\"M3.5 4.5h17v11.5H11l-5 4.5v-4.5H3.5z\"/><path d=\"M8 8.5l1.6 4L12 8.5l2.4 4L16 8.5\"/>", "donut": "<circle cx=\"12\" cy=\"12\" r=\"9.5\"/><circle cx=\"12\" cy=\"12\" r=\"3.2\"/><path d=\"M7 8.5l1.3.6M15.5 6.4l.6 1.3M16.6 15l1.3.6M8 15.8l.6 1.3M11.5 5.2h1.4M5.3 12.5v1.3\"/>", "bell": "<path d=\"M6 16.5V11a6 6 0 0112 0v5.5l2 2H4z\"/><path d=\"M10 21.5h4M12 2.5V5\"/>", "hat": "<path d=\"M2 14.5c3 3.5 17 3.5 20 0\"/><path d=\"M6 15.5C6 10 7 5.5 9 5.5c1 0 2 1 3 1s2-1 3-1c2 0 3 4.5 3 10\"/><path d=\"M6.5 12.5c3 1 8 1 11 0\"/>", "dice": "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4.5\"/><circle cx=\"8\" cy=\"8\" r=\"1.2\"/><circle cx=\"12\" cy=\"12\" r=\"1.2\"/><circle cx=\"16\" cy=\"16\" r=\"1.2\"/>", "siren": "<path d=\"M7 18v-6a5 5 0 0110 0v6\"/><path d=\"M4.5 18h15v3.5h-15zM12 2v2.5M4 5.5l1.7 1.7M20 5.5l-1.7 1.7M12 10v4\"/>", "flame": "<path d=\"M12 22c4 0 7-3 7-7 0-5-5-7-5-12.5-3 2-5 5-5 8.5-1-1-2-2.2-2-4.2-2 2-2 5-2 8.2 0 4 3 7 7 7z\"/><path d=\"M12 22c-2 0-3-1.5-3-3.5 0-2.5 3-4 3-6.5 1.5 1.5 3 3.5 3 6.5 0 2-1 3.5-3 3.5z\"/>", "helix": "<path d=\"M7 2c0 6.5 10 7.5 10 14v6M17 2c0 6.5-10 7.5-10 14v6M8.3 5.5h7.4M8.3 18.5h7.4M10 12h4\"/>", "bolt": "<path d=\"M13.5 2 4 14h7l-1.5 8L19 10h-7z\"/>", "ring": "<ellipse cx=\"12\" cy=\"12\" rx=\"10\" ry=\"4.2\" transform=\"rotate(-20 12 12)\"/><circle cx=\"12\" cy=\"12\" r=\"3.2\"/>", "shield": "<path d=\"M12 2l8 3v6.5c0 4.8-3.5 8.8-8 10.5-4.5-1.7-8-5.7-8-10.5V5z\"/><path d=\"M12 7v9M8.5 11.5h7\"/>", "pad": "<path d=\"M6.5 8h11a4.5 4.5 0 014.5 4.5V14a3 3 0 01-5.3 1.9L15.2 14H8.8l-1.5 1.9A3 3 0 012 14v-1.5A4.5 4.5 0 016.5 8z\"/><path d=\"M7 10.5v3M5.5 12h3M16 11h.01M18 13h.01\"/>"};
const icon = (g, cls = "stk") => `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[(g && g.icon)] || ICONS.pad}</svg></span>`;
// 10% always buys back $CONSOLE; the dev's pick splits the other 90% between the AI and the dev.
const shares = ai => ({ buyback: 10, compute: +(0.9 * ai).toFixed(1), dev: +(0.9 * (100 - ai)).toFixed(1) });
const splitBar = ai => { const s = shares(ai); return `<div class="split" role="img" aria-label="${s.compute}% AI compute, ${s.buyback}% $CONSOLE buyback and burn, ${s.dev}% to the dev"><i style="width:${s.compute}%"></i><i style="width:${s.buyback}%"></i>${s.dev > 0 ? `<i style="width:${s.dev}%"></i>` : ""}</div>`; };
const splitText = ai => { const s = shares(ai); return `${s.compute}% AI work on this combo · ${s.buyback}% buys back and burns $CONSOLE${s.dev > 0 ? ` · ${s.dev}% to the dev` : ""}`; };
const TINT = { N64: "#d6ecff", PS1: "#ece6f5", GBA: "#e4dcff", PS2: "#c9f2df", PS3: "#e6e8ec", PS4: "#d9e2ff", X360: "#d7f2c8", PC: "#fff1b8" };
const tint = p => TINT[p] || "#ffe0ee";
function cart(t, opt = {}) {
  const combo = t.kind === "combo", gs = combo ? gamesOf(t) : [];
  const st = opt.preview ? ["s-new", "Not launched"] : statusOf(t);
  const coin = opt.preview ? opt.preview : t.coin;
  const name = opt.preview ? coin.n : t.name;
  let body;
  if (combo) {
    const r = comboReady(t);
    body = `<div class="ctints">${gs.map(g => `<span style="background:${tint(g.platform)}">${icon(g)}</span>`).join("")}</div>
      <b class="cname">${esc(name)}</b><span class="idea">${esc(t.idea)}</span>
      <div class="parts">${gs.map(g => `<div><span>${esc(g.name)}</span><span class="num">${overall(g).toFixed(0)}%</span></div>${meter(g)}`).join("")}</div>
      ${coin && !opt.preview && coin.tasks ? `<div class="trow small"><span>AI tasks</span><span class="num">${coin.tasks.done} done · next at ${coin.tasks.next} SOL</span></div>` : ""}
      <div class="trow"><span class="pill ${coin ? "" : "hot"}">${coin && !opt.preview ? "$" + esc(coin.t) + " live" : opt.preview ? "$" + esc(coin.t) : "Open to launch"}</span>${coin ? `<span class="pill ai" title="Share of fees the dev sends to the AI">AI ${esc(opt.preview ? aiPick() : coin.aiPct)}%</span>` : `<span class="muted">${r.ready} of ${r.of} at Native port</span>`}</div>`;
    const inner = `<div class="ccard-in">${body}</div>`;
    return opt.link ? `<a class="ccard" href="#game-${esc(t.id)}" aria-label="${esc(t.name + ", " + st[1] + (coin ? ", dev sends " + coin.aiPct + "% of fees to the AI" : ""))}">${inner}</a>` : `<div class="ccard">${inner}</div>`;
  }
  const P = plat(t.platform);
  body = `<div class="tart" data-plat="${esc(t.platform)}" style="--tint:${tint(t.platform)}"><span class="pill white">${esc(P.l)}</span><span class="status ${st[0]}"><i></i>${st[1]}</span>${icon(t)}<b class="tname">${esc(name)}</b></div>
    <div class="trow"><span>Stage ${si(t) + 1} · ${STAGES[si(t)].t}</span><b class="num">${overall(t).toFixed(0)}%</b></div>${meter(t)}
    <div class="trow"><span class="coinl">${t.combos ? `In ${t.combos} combo${t.combos > 1 ? "s" : ""}` : "Not combined yet"}</span><span class="pill dark">Combine</span></div>`;
  const aria = `${t.name}${t.coin ? ", $" + t.coin.t : ", no coin yet"}, ${st[1]}`;
  return opt.link ? `<a class="tcard" href="#game-${esc(t.id)}" aria-label="${esc(aria)}">${body}<span class="hint" aria-hidden="true"><kbd class="pad">A</kbd>Open</span></a>` : `<div class="tcard">${body}</div>`;
}

const KIND = { launch: "LAUNCH", claim: "CLAIM", compute: "FUNDED", buyback: "BUYBACK", dev: "DEV", burn: "BURN" };
function actRow(a) {
  const t = byId(a.target), tick = t && t.coin ? "$" + t.coin.t : "", name = t ? t.name : "";
  const what = a.kind === "launch" ? `${tick} launched for ${name}` : a.kind === "claim" ? `${tick} fees claimed` : a.kind === "compute" ? `${name} AI compute` : a.kind === "buyback" ? `$CONSOLE buyback from ${tick}` : a.kind === "dev" ? `${tick} dev payout` : a.kind === "burn" ? "$CONSOLE bought back and burned" : `${tick} ${a.kind}`;
  const amt = a.sol > 0 ? " · " + fmtSol(a.sol) : "";
  const inner = `<span class="kind k-${esc(a.kind)}">${KIND[a.kind] || esc(a.kind).toUpperCase()}</span><span class="what">${esc(what)}${amt}</span><span class="ago">${ago(a.at)}</span>`;
  return `<li>${a.tx ? `<a href="https://solscan.io/tx/${esc(a.tx)}" target="_blank" rel="noopener" style="display:contents;text-decoration:none">${inner}</a>` : inner}</li>`;
}

// ---------- render ----------
function renderAll() {
  const b = $("#banner");
  if (S.empty) { b.className = "banner"; b.textContent = "Preview: Console on launch day, before any coins exist."; }
  else if (S.demo) { b.className = "banner"; b.textContent = "Example data: the combo coins, prices and activity are made up."; }
  else if (loadErr) { b.className = "banner"; b.textContent = "We couldn't load live data. Retrying in a few seconds."; }
  else if (!S.launchesOpen) { b.className = "banner live"; b.textContent = "Launches open soon. You can look around now."; }
  else b.hidden = true;
  if (S.demo || loadErr || !S.launchesOpen) b.hidden = false;


  // hero feature + feed
  const withCoin = S.games.filter(g => g.coin).sort((a, b) => overall(b) - overall(a));
  const f = withCoin[0] || [...S.games].sort((a, b) => overall(b) - overall(a))[0];
  if (f) {
    $("#feature").href = "#game-" + f.id;
    $("#feature").innerHTML = `<div class="row"><b>${esc(f.name)}</b><span class="mono muted">${f.coin ? "$" + esc(f.coin.t) + " · " : ""}${esc(plat(f.platform).l)}</span></div>${meter(f, true)}<div class="row small"><span>Stage ${si(f) + 1} of 5 · ${STAGES[si(f)].t}</span><span class="num">${overall(f).toFixed(0)}% overall</span></div>`;
  }
  if (!S.demo || S.empty) $("#homefeed").innerHTML = S.activity.length ? S.activity.slice(0, 5).map(actRow).join("") : `<li style="display:grid;grid-template-columns:1fr;gap:10px;padding:18px 14px"><b>No activity yet</b><span class="muted">Launches, fee claims and AI funding show up here as they happen.</span><a class="btn sm dark" href="#launch" style="justify-self:start">Launch the first coin</a></li>`;
  if (S.demo && !S.empty && !$("#homefeed").children.length) seedDemoFeed();
  $("#livefeed").innerHTML = S.activity.length ? S.activity.slice(0, 14).map(actRow).join("") : `<li><span class="boot" style="grid-column:1/-1;color:var(--muted)">&gt; no activity yet</span></li>`;

  // stats: real totals once coins exist, otherwise what a first visitor needs to know
  const launchDay = !S.totals.coins;
  const tiles = launchDay
    ? [["t-mint", "Games to combine", S.games.length], ["t-butter", "Suggested combos", S.combos.filter(c => c.suggested).length], ["t-lilac", "Burned on every pool", "10%"], ["t-sky", "Pool splits at", S.thresholdSol + " SOL"]]
    : [["t-mint", "Sent to AI", fmtSol(S.totals.funded)], ["t-butter", "Coins live", S.totals.coins], ["t-lilac", "Waiting in pools", fmtSol(S.totals.waiting)], ["t-sky", "Games to combine", S.games.length]];
  $("#stats").innerHTML = tiles.map(([c, l, v]) => `<div class="stat ${c}"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join("");

  // closest to done, or the suggested combos while nothing has started
  const started = S.games.some(g => overall(g) > 0);
  const sugg = S.combos.filter(c => c.suggested && c.open && !c.coin).slice(0, 3);
  $("#h-top").textContent = started ? "Closest to done" : "Ready to launch";
  $("#p-top").textContent = started ? "Overall progress across all five stages." : "Suggested combos waiting for their first coin. Pick one, or combine any games you like.";
  $("#top3").innerHTML = started
    ? [...S.games].sort((a, b) => overall(b) - overall(a)).slice(0, 3).map((g, i) => `<a class="t3" href="#game-${esc(g.id)}" style="--plat:${plat(g.platform).c}"><span class="rk">${i + 1}</span><span class="nm">${esc(g.name)}</span><span class="pc">${overall(g).toFixed(0)}%</span>${meter(g)}<span class="nx">Next unlock: ${STAGES[si(g)].u}</span></a>`).join("") || `<div class="empty small">No games yet.</div>`
    : sugg.length ? sugg.map(c => `<div class="t3 sug"><span class="rk icons" aria-hidden="true">${gamesOf(c).map(g => icon(g, "stk xs")).join("")}</span><span class="nm">${esc(c.name)}</span><button class="btn sm dark" type="button" data-launch="${esc(c.id)}">Launch this combo</button><span class="nx">${esc(gamesOf(c).map(g => g.name).join(" + "))}</span></div>`).join("")
    : `<div class="empty small"><b>No suggested combos yet</b><span>Pick any 2 or 3 games and launch the first coin.</span><a class="btn sm dark" href="#launch">Launch a coin</a></div>`;

  renderChips(); renderGrid(); renderCombos();

  // pools
  $("#threshold").textContent = `Each coin's pool is split once it holds ${S.thresholdSol} SOL or more.`;
  $("#pl-waiting").textContent = fmtSol(S.totals.waiting);
  $("#pl-funded").textContent = fmtSol(S.totals.funded);
  $("#pl-buyback").textContent = fmtSol(S.totals.buyback);
  $("#pl-dev").textContent = fmtSol(S.totals.dev);
  $("#pl-burned").textContent = S.totals.burnedTokens ? Math.round(S.totals.burnedTokens).toLocaleString() : "0";
  $("#lastclaim").textContent = S.lastClaimAt ? `Fees were last claimed from pump.fun ${ago(S.lastClaimAt)} ago. The claim job runs every 30 minutes.` : "No fees claimed yet. The claim job runs every 30 minutes once coins are live.";
  $("#log-burn").innerHTML = S.burns.length ? S.burns.map(b => `<li><span>${Math.round(b.tokens).toLocaleString()} $CONSOLE burned${b.note ? " · " + esc(b.note) : ""}<span class="t">${ago(b.at)} ago${b.tx ? ` · <a href="https://solscan.io/tx/${esc(b.tx)}" target="_blank" rel="noopener">view</a>` : ""}</span></span><span class="amt">${fmtSol(b.sol)}</span></li>`).join("") : `<li><span class="muted">No burns yet. Each one is recorded here with its transaction.</span></li>`;
  for (const k of ["compute", "buyback", "dev"]) {
    const rows = S.activity.filter(a => a.kind === k);
    $("#log-" + k).innerHTML = rows.length ? rows.map(a => { const t = byId(a.target); return `<li><span>${esc(t ? t.name : a.target)}${t && t.coin ? " · $" + esc(t.coin.t) : ""}<span class="t">${ago(a.at)} ago${a.tx ? ` · <a href="https://solscan.io/tx/${esc(a.tx)}" target="_blank" rel="noopener">view</a>` : ""}</span></span><span class="amt">${fmtSol(a.sol)}</span></li>`; }).join("") : `<li><span class="muted">Nothing sent yet. Pools are split once they reach ${S.thresholdSol} SOL.</span></li>`;
  }
  $("#addrs").innerHTML = ["compute", "buyback"].map(k => `<div><span class="muted">${k === "compute" ? "AI compute" : "Buyback and burn"}</span>${S.wallets[k] ? `<a href="https://solscan.io/account/${esc(S.wallets[k])}" target="_blank" rel="noopener">${esc(S.wallets[k])}</a>` : '<span class="muted">Published at launch</span>'}</div>`).join("");

  renderGlist(); preview();
  if (!$("[data-view=game]").hidden && current.game) renderGame(byId(current.game));
}

// grid
let platF = "all", q = "", sort = "pct", showAll = false;
const LIMIT = () => matchMedia("(max-width:820px)").matches ? 4 : 9;
function renderChips() {
  const used = [...new Set(S.games.map(g => g.platform))];
  $("#chips").innerHTML = `<button class="chip" type="button" aria-pressed="${platF === "all"}" data-p="all">All</button>` + used.map(k => `<button class="chip" type="button" aria-pressed="${platF === k}" data-p="${esc(k)}" style="--plat:${plat(k).c}"><i></i>${esc(plat(k).l)}</button>`).join("");
}
function renderGrid() {
  let list = S.games.filter(g => (platF === "all" || g.platform === platF) && (!q || (g.name + " " + (g.coin ? g.coin.t + " " + g.coin.n : "") + " " + plat(g.platform).l).toLowerCase().includes(q)));
  list.sort(sort === "mc" ? (a, b) => b.combos - a.combos || a.name.localeCompare(b.name) : sort === "open" ? (a, b) => a.combos - b.combos || a.name.localeCompare(b.name) : (a, b) => overall(b) - overall(a) || a.name.localeCompare(b.name));
  const cut = !showAll && list.length > LIMIT();
  const shown = cut ? list.slice(0, LIMIT()) : list;
  $("#grid").innerHTML = list.length ? shown.map(g => cart(g, { link: true })).join("") : `<div class="empty"><b>No games match that</b><span>Try another platform or search term.</span><button class="btn" type="button" id="clr">Clear filters</button></div>`;
  const m = $("#more"); m.hidden = !cut; if (cut) m.textContent = `Show all ${list.length} games`;
}
// combos: filter chips + sort
let cF = "all", cSort = "live", cAll = false;
function renderCombos() {
  const chips = [["all", "All"], ["live", "Live coins"], ["open", "Open to launch"], ["ai100", "100% to AI"]];
  $("#cchips").innerHTML = chips.map(([k, l]) => `<button class="chip" type="button" aria-pressed="${cF === k}" data-c="${k}">${l}</button>`).join("");
  let list = S.combos.filter(c => cF === "all" || (cF === "live" && c.coin) || (cF === "open" && !c.coin) || (cF === "ai100" && c.coin && c.coin.aiPct === 100));
  const ai = c => (c.coin ? c.coin.aiPct : -1), mc = c => (c.coin ? c.coin.mc : -1), at = c => (c.coin ? c.coin.createdAt : 0);
  list.sort(cSort === "ai" ? (a, b) => ai(b) - ai(a) || mc(b) - mc(a) : cSort === "mc" ? (a, b) => mc(b) - mc(a) : cSort === "new" ? (a, b) => at(b) - at(a) : (a, b) => (b.coin ? 1 : 0) - (a.coin ? 1 : 0) || mc(b) - mc(a));
  const cut = !cAll && matchMedia("(max-width:820px)").matches && list.length > 4;
  const cm = $("#cmore"); cm.hidden = !cut; if (cut) cm.textContent = `Show all ${list.length} combos`;
  if (cut) list = list.slice(0, 4);
  $("#combogrid").innerHTML = list.length ? list.map(c => cart(c, { link: true })).join("") : S.combos.length ? `<div class="empty"><b>No combos match that</b><span>Try another filter.</span><button class="btn" type="button" id="cclr">Show all combos</button></div>` : `<div class="empty"><b>No combos yet</b><span>Pick any 2 or 3 games and launch the first one.</span><a class="btn primary" href="#launch">Launch a coin</a></div>`;
}
$("#cchips").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; cF = b.dataset.c; renderCombos(); });
$("#combogrid").addEventListener("click", e => { if (e.target.closest("#cclr")) { cF = "all"; renderCombos(); } });
$("#csort").onchange = e => { cSort = e.target.value; renderCombos(); };
$("#cmore").onclick = () => { cAll = true; renderCombos(); };
matchMedia("(max-width:820px)").addEventListener("change", renderCombos);
$("#top3").addEventListener("click", e => { const b = e.target.closest("[data-launch]"); if (!b) return; pendingPicks = b.dataset.launch.split("+"); location.hash = "#launch"; });
$("#chips").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; platF = b.dataset.p; renderChips(); renderGrid(); });
$("#grid").addEventListener("click", e => { if (e.target.closest("#clr")) { platF = "all"; q = ""; $("#q").value = ""; renderChips(); renderGrid(); } });
$("#sort").onchange = e => { sort = e.target.value; renderGrid(); };
$("#q").oninput = e => { q = e.target.value.trim().toLowerCase(); renderGrid(); };
$("#more").onclick = () => { showAll = true; renderGrid(); };
matchMedia("(max-width:820px)").addEventListener("change", renderGrid);

// stages + glossary tip
$("#stages").innerHTML = STAGES.map((s, i) => `<li><span class="sn">Stage ${i + 1}</span><b>${s.t}${s.q ? ` <span class="q"><button type="button" aria-expanded="false" aria-controls="tip-match" aria-label="What does matching mean?">?</button><span class="tip" id="tip-match" role="tooltip" hidden>A function counts only when the AI's C compiles to exactly the same bytes as the original. No match, no progress.</span></span>` : ""}</b><p>${s.d}</p><span class="unlock"><span>Unlocks:</span> ${s.u}</span></li>`).join("");
document.addEventListener("click", e => {
  const b = e.target.closest(".q button");
  $$(".q .tip").forEach(t => { if (!b || t !== b.nextElementSibling) { t.hidden = true; t.previousElementSibling.setAttribute("aria-expanded", "false"); } });
  if (b) { const t = b.nextElementSibling; t.hidden = !t.hidden; b.setAttribute("aria-expanded", String(!t.hidden)); }
});

// demo-only streaming match feed (clearly example data)
const WHAT = ["player jump arc", "kart drift boost", "camera follow", "item box roll table", "lap counter", "CPU rubber-banding", "audio voice alloc", "save file checksum", "collision vs track", "menu cursor wrap"];
let fn = 0;
function demoRow(anim) {
  const ok = fn % 5 !== 3, li = document.createElement("li"); if (anim) li.className = "new";
  const a = "func_80" + (0x020000 + ((fn * 7919) % 65536) * 16).toString(16).toUpperCase().padStart(6, "0");
  li.innerHTML = `<span class="addr">${a}</span><span class="tag ${ok ? "ok" : "retry"}">${ok ? "MATCH" : "RETRY"}</span><span class="what">${WHAT[fn % WHAT.length]}</span>`;
  fn++; return li;
}
function seedDemoFeed() { const hf = $("#homefeed"); hf.innerHTML = ""; for (let i = 0; i < 5; i++) hf.appendChild(demoRow(false)); }
if (CONFIG.demo && !CONFIG.empty && !reduce) setInterval(() => { if ($("[data-view=explore]").hidden) return; const hf = $("#homefeed"); hf.prepend(demoRow(true)); while (hf.children.length > 5) hf.lastChild.remove(); }, 1600);

// ---------- match viewer (example code, the same everywhere) ----------
const ASM = [["lw", "t6, 0x24(a0)", 0], ["beqz", "t6, .L1", 1], ["lui", "at, 0x4120", 2], ["mtc1", "at, f4", 3], ["sw", "zero, 0x24(a0)", 4], ["swc1", "f4, 0x18(a0)", 5], [".L1:", "", null], ["jr", "ra", 6], ["nop", "", 7]];
const ORIG = ["8C8E0024", "11C00004", "3C014120", "44812000", "AC800024", "E4840018", "03E00008", "00000000"];
const TRY1 = ["8C8E0024", "11C00004", "3C014120", "44812000", "E4840018", "AC800024", "03E00008", "00000000"];
const C1 = ["void Player_Jump(Player* p) {", "    if (p->onGround) {", "        p->velY = 10.0f;", "        p->onGround = FALSE;", "    }", "}"];
const C2 = ["void Player_Jump(Player* p) {", "    if (p->onGround) {", "        p->onGround = FALSE;", "        p->velY = 10.0f;", "    }", "}"];
const hlC = l => esc(l).replace(/\b(void|if)\b/g, '<span class="kw">$1</span>');
function Matcher(host) {
  host.innerHTML = `<div class="mv">
    <div class="mv-head"><span class="mv-fn"><b>func_80024A10</b> · Player_Jump · example</span><span class="mv-state" data-st>Ready</span><button class="btn sm" type="button" data-replay>Replay</button></div>
    <div class="mv-cols">
      <div class="mv-col"><div class="mv-cap"><span>Original · MIPS assembly</span></div><pre class="code" data-asm>${ASM.map(([o, a]) => `<span class="ln">${o.startsWith(".") ? `<span class="cm">${o}</span>` : `${o.padEnd(6)}${esc(a)}`}</span>`).join("")}</pre></div>
      <div class="mv-col"><div class="mv-cap"><span>AI rewrite · C</span><span data-att>Attempt 1</span></div><pre class="code" data-c>${C1.map(() => '<span class="ln"></span>').join("")}</pre></div>
    </div>
    <div class="mv-bytes"><div class="mv-cap"><span>Bytes · original over compiled</span></div><div class="bytes">${ORIG.map(o => `<div class="bw"><span class="o">${o}</span><span class="c">········</span></div>`).join("")}</div></div>
    <p class="mv-note">Example code. A function only counts toward progress when every byte matches the original.</p>
  </div>`;
  const st = host.querySelector("[data-st]"), cl = [...host.querySelectorAll("[data-c] .ln")], al = [...host.querySelectorAll("[data-asm] .ln")], bw = [...host.querySelectorAll(".bw")], att = host.querySelector("[data-att]"), mv = host.querySelector(".mv");
  let timers = [];
  const at = (ms, f) => timers.push(setTimeout(f, ms));
  const setSt = (t, c) => { st.textContent = t; st.className = "mv-state" + (c ? " " + c : ""); };
  const stamp = () => { const s = document.createElement("div"); s.className = "stamp"; s.textContent = "MATCH"; mv.appendChild(s); };
  function reset() { timers.forEach(clearTimeout); timers = []; const s = mv.querySelector(".stamp"); if (s) s.remove(); cl.forEach(l => { l.innerHTML = ""; l.className = "ln"; }); al.forEach(l => l.className = "ln"); bw.forEach(b => { b.className = "bw"; b.querySelector(".c").textContent = "········"; }); }
  function compare(words, start, step) {
    words.forEach((w, i) => at(start + i * step, () => { al.forEach(l => l.classList.remove("hl")); const ai = ASM.findIndex(x => x[2] === i); if (ai > -1) al[ai].classList.add("hl"); bw[i].querySelector(".c").textContent = w; bw[i].className = "bw " + (w === ORIG[i] ? "m" : "x"); }));
    at(start + words.length * step, () => al.forEach(l => l.classList.remove("hl")));
  }
  function finalState() { reset(); C2.forEach((l, i) => cl[i].innerHTML = hlC(l)); att.textContent = "Attempt 2"; ORIG.forEach((w, i) => { bw[i].querySelector(".c").textContent = w; bw[i].className = "bw m"; }); setSt("Match", "ok"); stamp(); }
  function run() {
    if (reduce) { finalState(); return; }
    reset(); att.textContent = "Attempt 1"; setSt("Writing C");
    C1.forEach((l, i) => at(150 + i * 170, () => cl[i].innerHTML = hlC(l)));
    at(1300, () => setSt("Compiling")); compare(TRY1, 1500, 170);
    at(3000, () => setSt("Retry · store order differs", "retry"));
    at(4300, () => { att.textContent = "Attempt 2"; setSt("Writing C"); cl[2].innerHTML = hlC(C2[2]); cl[3].innerHTML = hlC(C2[3]); cl[2].className = "ln chg"; cl[3].className = "ln chg"; bw.forEach(b => { b.className = "bw"; b.querySelector(".c").textContent = "········"; }); });
    at(5200, () => { setSt("Compiling"); cl.forEach(l => l.className = "ln"); });
    compare(ORIG, 5400, 170); at(6900, () => { setSt("Match", "ok"); stamp(); });
  }
  host.querySelector("[data-replay]").onclick = run;
  return { run, stop: reset };
}
let activeMatcher = null;
const stopMatcher = () => { if (activeMatcher) activeMatcher.stop(); activeMatcher = null; };

// tabs
function wireTabs(root, onChange) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const sel = (i, focus) => { tabs.forEach((t, j) => { const on = i === j; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; document.getElementById(t.getAttribute("aria-controls")).hidden = !on; }); if (focus) tabs[i].focus(); if (onChange) onChange(tabs[i].dataset.key); };
  tabs.forEach((t, i) => { t.onclick = () => sel(i); t.onkeydown = e => { if (e.key === "ArrowRight") { e.preventDefault(); sel((i + 1) % tabs.length, true); } if (e.key === "ArrowLeft") { e.preventDefault(); sel((i - 1 + tabs.length) % tabs.length, true); } }; });
}
wireTabs($("#pooltabs"));

// ---------- AI work (tasks unlock every 1 SOL of volume) ----------
const TASK_STATUS = ["queued", "running", "done", "failed"];
function demoTasks(c) {
  const now = Date.now(), H = 36e5, T = ["Map the game: engine, file formats and tools", "Outline the asset formats", "Plan how to split the code into functions", "Draft the matching plan", "List the systems needed to run on PC", "Draft the mod-loader design", "Risks and gaps", "Write the player guide"];
  return Array.from({ length: c.tasks.unlocked }, (_, i) => c.tasks.unlocked - i).map(n => ({ n, title: T[(n - 1) % T.length], status: n <= c.tasks.done ? "done" : n === c.tasks.done + 1 ? "running" : "queued", by: n <= c.tasks.done ? "ai" : "", model: n <= c.tasks.done ? "claude-sonnet-5-5" : "", summary: n <= c.tasks.done ? "Example result: a short summary of what this task found goes here." : "", detail: n <= c.tasks.done ? "Example notes. In a live coin the AI's written notes for this task show here, in plain text." : "", volSol: n, at: now - (c.tasks.unlocked - n + 1) * 3 * H }));
}
function workPanel(t, c) {
  if (!c) return `<div class="empty small"><b>No tasks yet</b><span>Once this combo has a coin, one AI task unlocks for every ${esc(S.taskEverySol || 1)} SOL of trading volume.</span></div>`;
  const every = S.taskEverySol || 1, tk = c.tasks, prev = tk.next - every, pct = Math.max(0, Math.min(100, ((c.vol - prev) / every) * 100)), queued = Math.max(0, tk.unlocked - tk.done);
  return `<div class="wk"><div class="panel wk-meter"><div class="trow"><span>Next task at ${esc(tk.next)} SOL</span><b class="num">${c.vol.toFixed(2)} SOL volume</b></div>
    <div class="wbar" role="img" aria-label="${Math.round(pct)}% of the way to the next task"><i style="width:${pct}%"></i></div>
    <p class="hintx">One task unlocks for every ${esc(every)} SOL traded. Volume is estimated from the creator fees collected, so it can lag the real number a little.</p></div>
    <div class="fees3"><div class="panel"><span class="hintx">Tasks unlocked</span><div class="big" style="font-size:26px">${tk.unlocked}</div></div><div class="panel"><span class="hintx">Done</span><div class="big" style="font-size:26px">${tk.done}</div></div><div class="panel"><span class="hintx">Waiting or running</span><div class="big" style="font-size:26px">${queued}</div></div></div>
    <div id="wk-feed" aria-live="polite"><div class="empty small"><b>Loading tasks…</b></div></div>
    <p class="hintx">Each task is run by an AI model that has no access to the game's files. It writes notes from public knowledge. They aren't decompiled code, and the Progress tab is separate: the Console team posts that from real build results.</p></div>`;
}
async function loadTasks(c) {
  const box = $("#wk-feed"); if (!box || !c) return;
  let rows = [];
  try {
    if (CONFIG.demo) rows = demoTasks(c);
    else { const r = await fetch(CONFIG.api + "/tasks?mint=" + encodeURIComponent(c.mint), { cache: "no-store" }); if (!r.ok) throw new Error("tasks"); rows = ((await r.json()).tasks || []).slice(0, 40); }
  } catch (e) { box.innerHTML = `<div class="empty small"><b>Couldn't load the tasks</b><button class="btn sm" type="button" id="wk-retry">Try again</button></div>`; const b = $("#wk-retry"); if (b) b.onclick = () => loadTasks(c); return; }
  if (!rows.length) { box.innerHTML = `<div class="empty small"><b>No tasks yet</b><span>The first unlocks at ${esc(S.taskEverySol || 1)} SOL of volume.</span></div>`; return; }
  const note = r => r.status === "done" ? (r.by === "ai" ? "Done by AI" + (r.model ? " · " + esc(r.model) : "") : "Done by the Console team") : r.status === "running" ? "Running now" : r.status === "failed" ? "Failed after 3 tries. The team will look at it." : S.workerOn ? "Queued. The AI picks it up within about 10 minutes." : "Queued. Waiting for the team to run it.";
  box.innerHTML = `<ul class="tlist">${rows.map(r => { const st = TASK_STATUS.includes(r.status) ? r.status : "queued"; return `<li class="task ${st}"><span class="tdot" aria-hidden="true"></span><div><b>${esc(num(r.n))}. ${esc(String(r.title).slice(0, 120))}</b><p class="muted">${note({ ...r, status: st })}${r.volSol ? " · unlocked at " + esc(num(r.volSol)) + " SOL" : ""}</p>${st === "done" ? `<details><summary>${esc(String(r.summary || "").slice(0, 200))}</summary>${r.detail ? `<div class="tdetail">${esc(String(r.detail).slice(0, 4000))}</div>` : ""}</details>` : ""}</div><span class="tmeta">${r.at ? ago(r.at) : ""}</span></li>`; }).join("")}</ul>`;
}

// ---------- game / combo page ----------
const current = { game: null };
function renderGame(t) {
  if (!t) { $("#gv").innerHTML = `<div class="empty"><b>That game isn't on Console</b><a class="btn" href="#explore">Back to games</a></div>`; return; }
  const combo = t.kind === "combo", c = t.coin, gs = combo ? gamesOf(t) : [];
  const head = `<div class="gv-head"><div class="gv-cart">${cart(t)}</div><div class="gv-info">
    <div style="display:flex;gap:14px;align-items:center">${c && c.img ? `<img class="coinimg" src="${esc(c.img)}" alt="">` : ""}<h1 tabindex="-1" id="h-game">${esc(t.name)}</h1></div>
    <div class="gv-sub">${c ? `<span>$${esc(c.t)}</span><span>·</span>` : ""}<span>${combo ? "Combo: " + esc(gs.map(g => g.name).join(" + ")) : esc(plat(t.platform).l)}</span></div>
    ${c ? `<div class="kv"><div>Market cap<b>${fmtMC(c.mc)}</b></div><div>${combo ? "Games ready" : "Overall"}<b>${combo ? comboReady(t).ready + " of " + comboReady(t).of : overall(t).toFixed(1) + "%"}</b></div><div>Sent to AI<b>${fmtSol(c.funded)}</b></div><div>Dev sends to AI<b>${combo ? c.aiPct + "%" : "—"}</b></div><div>Waiting in pool<b>${fmtSol(c.pool)}</b></div></div>
      <div class="ca"><span>${esc(c.mint)}</span><button class="btn sm" type="button" id="cpy">Copy address</button></div>
      <div class="actions"><a class="btn primary lg" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">Buy $${esc(c.t)} on pump.fun</a><a class="btn" href="https://dexscreener.com/solana/${esc(c.mint)}" target="_blank" rel="noopener">Chart</a></div>`
    : combo ? `<div class="panel" style="display:grid;gap:12px;background:var(--bg)"><b style="font-size:17px">No coin yet</b><p class="muted">This combo is suggested. Launch its coin and the fees fund work on both games, then the crossover once both reach Native port.</p><div><button class="btn primary lg" type="button" id="gv-launch">Launch this combo</button></div></div>`
    : `<div class="panel" style="display:grid;gap:12px;background:var(--bg)"><b style="font-size:17px">${t.combos ? `In ${t.combos} combo${t.combos > 1 ? "s" : ""}` : "Not combined yet"}</b><p class="muted">Coins are launched for combos only. Pick this game plus 1 or 2 others, and that combo's fees pay for the AI work on all of them.</p><div><button class="btn primary lg" type="button" id="gv-launch" ${t.open ? "" : "disabled"}>${t.open ? "Combine this game" : "Not open right now"}</button></div></div>`}
  </div></div>`;
  const progress = combo
    ? `<ul class="plist">${gs.map(g => `<li><span class="pst ${si(g) >= 3 ? "done" : "cur"}" style="--p:${Math.min(100, overall(g) / 0.8)}%" aria-hidden="true"></span><div><b><a href="#game-${esc(g.id)}">${esc(g.name)}</a></b><p>Stage ${si(g) + 1} · ${STAGES[si(g)].t}</p><div class="detail">${meter(g, true)}</div></div><span class="pp">${si(g) >= 3 ? "Ready" : overall(g).toFixed(0) + "%"}</span></li>`).join("")}
       <li><span class="pst" aria-hidden="true"></span><div><b>Build the crossover</b><p>${esc(t.idea)} Starts once every game above reaches Native port. Players need their own copy of each game.</p></div><span class="pp">${comboReady(t).ready === comboReady(t).of ? "Ready" : "Locked"}</span></li></ul>`
    : `<ul class="plist">${STAGES.map((s, i) => { const cls = i < si(t) ? "done" : i === si(t) ? "cur" : ""; return `<li><span class="pst ${cls}" style="--p:${num(t.pct)}%" aria-hidden="true"></span><div><b>${s.t}</b><p>${s.d}</p><p><span style="color:var(--fg)">Unlocks:</span> ${s.u}</p>${i === si(t) ? `<div class="detail">${meter(t, true)}${i === 2 && t.functions ? `<span class="hintx num">${Math.round(t.functions * num(t.pct) / 100).toLocaleString()} of ${t.functions.toLocaleString()} functions matched</span>` : ""}</div>` : ""}</div><span class="pp">${i < si(t) ? "Done" : i === si(t) ? num(t.pct) + "%" : "Locked"}</span></li>`; }).join("")}</ul>`;
  const code = `<span class="badge">Code only, no game files</span><p class="muted" style="max-width:62ch">The repo holds newly written code and tools. To build it, players supply their own copy of ${combo ? "each game" : "the game"}. It's never included or downloadable here.</p>${!combo && t.repo ? `<div><a class="btn" href="${esc(t.repo)}" target="_blank" rel="noopener">View the code on GitHub</a></div>` : `<p class="hintx">The code goes public as soon as work starts.</p>`}`;
  const mine = combo ? [] : S.combos.filter(x => x.games.includes(t.id));
  const fees = !combo ? (mine.length ? `<div class="cgrid">${mine.map(x => cart(x, { link: true })).join("")}</div>` : `<div class="empty small"><b>No combos with this game yet</b><span>Be the first to combine it.</span></div>`) : c ? `<div class="fees3"><div class="panel"><span class="hintx">Sent to AI compute</span><div class="big" style="font-size:26px">${fmtSol(c.funded)}</div></div><div class="panel"><span class="hintx">Waiting in pool</span><div class="big" style="font-size:26px">${fmtSol(c.pool)}</div></div><div class="panel"><span class="hintx">Pool splits at</span><div class="big" style="font-size:26px">${S.thresholdSol} SOL</div></div></div>${splitBar(c.aiPct)}<p class="muted">The dev chose ${c.aiPct}% for the AI when launching, and it can't be changed. Each split: ${esc(splitText(c.aiPct))}.</p><p class="hintx trust">${S.lastClaimAt ? `Fees last claimed ${ago(S.lastClaimAt)} ago.` : "No fees claimed yet."} Every payout is listed on the <a href="#pools">Pools</a> page with its Solscan link.</p>` : `<div class="empty small"><b>No fees yet</b><span>Fees start when this coin launches.</span></div>`;
  const TABS = [...(combo ? [{ k: "work", t: "AI work", h: workPanel(t, c) }] : []), { k: "progress", t: "Progress", h: progress }, { k: "match", t: "How matching works", h: '<div id="g-mv"></div>' }, { k: "fees", t: combo ? "Fees" : "Combos", h: fees }, { k: "code", t: "Code", h: code }];
  $("#gv").innerHTML = `<div style="display:grid;gap:24px"><a class="back" href="#explore"><span aria-hidden="true">←</span> Back to games <kbd class="pad" aria-hidden="true">B</kbd></a>${head}
    <div><div class="tabs" role="tablist" aria-label="Details" id="gtabs">${TABS.map((x, i) => `<button role="tab" id="gt-${i}" data-key="${x.k}" aria-controls="gp-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${x.t}</button>`).join("")}</div>
    ${TABS.map((x, i) => `<div class="tabpanel" role="tabpanel" id="gp-${i}" aria-labelledby="gt-${i}"${i ? " hidden" : ""}>${x.h}</div>`).join("")}</div></div>`;
  wireTabs($("#gtabs"), k => { stopMatcher(); if (k === "match") { activeMatcher = Matcher($("#g-mv")); activeMatcher.run(); } if (k === "work") loadTasks(c); });
  if (TABS[0].k === "work") loadTasks(c);
  const cp = $("#cpy"); if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(c.mint).then(() => toast("Address copied"), () => toast("Select the address to copy it")); } catch (e) { toast("Select the address to copy it"); } };
  const gl = $("#gv-launch"); if (gl) gl.onclick = () => { pendingPicks = combo ? t.games.slice() : [t.id]; location.hash = "#launch"; };
  const bb = $("#bb-in");
  bb.innerHTML = c ? `<span class="bb-lbl"><b>$${esc(c.t)}</b> <span class="num muted">${fmtMC(c.mc)}</span></span><a class="btn primary" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">Buy $${esc(c.t)}</a>` : `<span class="bb-lbl muted">${combo ? "No coin yet" : esc(t.name)}</span><button class="btn primary" type="button" id="bb-launch">${combo ? "Launch this combo" : "Combine"}</button>`;
  const bl = $("#bb-launch"); if (bl) bl.onclick = () => { pendingPicks = combo ? t.games.slice() : [t.id]; location.hash = "#launch"; };
}

// ---------- wallet ----------
function walletProvider() { return (window.phantom && window.phantom.solana) || window.solflare || (window.backpack && window.backpack.solana) || window.solana || null; }
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function openInWalletApp() { if (!IS_MOBILE) return false; location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(location.href) + "?ref=" + encodeURIComponent(location.origin); return true; }
function waitForWallet(ms = 1500) { return new Promise(ok => { const p = walletProvider(); if (p) return ok(p); const t0 = Date.now(), iv = setInterval(() => { const q = walletProvider(); if (q || Date.now() - t0 > ms) { clearInterval(iv); ok(q); } }, 100); }); }
const walletErr = err => err && err.code === 4001 ? "You cancelled in your wallet. Nothing was connected." : "Your wallet didn't connect. Unlock it and try again.";
let ME = null, MEDATA = null;
try { ME = localStorage.getItem("console-wallet") || null; if (!isAddr(ME)) ME = null; } catch (e) {}
function setMe(a) { ME = a; MEDATA = null; try { a ? localStorage.setItem("console-wallet", a) : localStorage.removeItem("console-wallet"); } catch (e) {} renderWallet(); lfWallet(); loadMe(); }
function renderWallet() { const w = $("#wallet"); w.innerHTML = ME ? `<span class="wallet-chip"><i></i><span class="mono">${esc(shortW(ME))}</span></span>` : "Connect wallet"; w.setAttribute("aria-label", ME ? `Wallet ${shortW(ME)}, open my coins` : "Connect wallet"); }
async function connectWallet(msgEl) {
  if (CONFIG.demo) { setMe("7xKpEXAMPLEwaLLetEXAMPLEwaLLet3fQa"); toast("Example wallet connected"); return true; }
  const prov = await waitForWallet();
  if (!prov) { if (openInWalletApp()) return false; (msgEl ? m => { msgEl.className = "msg err"; msgEl.textContent = m; } : toast)("No Solana wallet found. Install Phantom (phantom.app) and refresh."); return false; }
  try { const r = await prov.connect(); const a = String((r && r.publicKey) || prov.publicKey); if (!isAddr(a)) throw new Error("no address"); setMe(a); return true; }
  catch (err) { (msgEl ? m => { msgEl.className = "msg err"; msgEl.textContent = m; } : toast)(walletErr(err)); return false; }
}
$("#wallet").onclick = async () => { if (ME) location.hash = "#me"; else if (await connectWallet()) location.hash = "#me"; };
async function loadMe() {
  if (!ME || CONFIG.demo) { renderMe(); return; }
  try { const r = await fetch(CONFIG.api + "/wallet/" + encodeURIComponent(ME), { cache: "no-store" }); if (r.ok) MEDATA = await r.json(); } catch (e) {}
  renderMe();
}
function renderMe() {
  const host = $("#me"); host.className = "me";
  if (!ME) {
    host.innerHTML = `<div class="pagehead"><h1 id="h-me" tabindex="-1">My coins</h1></div><div class="empty"><b>Connect a wallet to see your coins</b><span>Your holdings and any coins you launch show up here. Connecting only shares your public address.</span><button class="btn primary" type="button" id="me-connect">Connect wallet</button></div>`;
    $("#me-connect").onclick = () => connectWallet(); return;
  }
  let hold, launched;
  if (CONFIG.empty) { hold = []; launched = []; }
  else if (CONFIG.demo) { hold = S.combos.filter(x => x.coin).slice(0, 2).map((x, i) => ({ t: x.coin.t, n: x.coin.n, target: x.id, tokens: [420000, 88000][i], pct: [0.042, 0.0088][i], usd: [77, 27][i] })); launched = []; }
  else { hold = MEDATA ? MEDATA.holdings : undefined; launched = MEDATA ? (MEDATA.launched || []) : []; }
  const holdRows = hold === undefined ? `<div class="empty small"><span>Loading…</span></div>` : hold === null ? `<div class="empty small"><b>Couldn't read your holdings</b><span>Try again in a minute.</span></div>` : !hold.length ? `<div class="empty"><b>You don't hold any Console coins yet</b><span>Pick a combo and buy its coin on pump.fun.</span><a class="btn primary" href="#combos">Browse combos</a></div>`
    : `<div class="table-wrap"><table><thead><tr><th>Combo</th><th>Coin</th><th>Holding</th><th>Value</th></tr></thead><tbody>${hold.map(h => { const t = byId(h.target); return `<tr><td><a href="#game-${esc(h.target)}" style="font-weight:600">${esc(t ? t.name : h.target)}</a></td><td class="mono">$${esc(h.t)}</td><td class="num">${num(h.tokens).toLocaleString()} <span class="muted">(${num(h.pct)}%)</span></td><td class="num">$${num(h.usd).toLocaleString()}</td></tr>`; }).join("")}</tbody></table></div>`;
  const launchedRows = launched.length ? `<div class="cgrid">${launched.map(c => { const t = byId(c.target); return t ? cart(t, { link: true }) : ""; }).join("")}</div>` : `<div class="empty"><b>You haven't launched a coin yet</b><span>Pick 2 or 3 games to combine and its fees start funding the work.</span><a class="btn primary" href="#launch">Launch a coin</a></div>`;
  host.innerHTML = `<div class="me-head"><div class="pagehead"><h1 id="h-me" tabindex="-1">My coins</h1><p class="mono">${esc(shortW(ME))}${CONFIG.demo ? " · example wallet" : ""}</p></div><button class="btn ghost" type="button" id="me-dis" style="margin-left:auto">Disconnect</button></div>
  <div><div class="tabs" role="tablist" aria-label="My coins" id="metabs"><button role="tab" id="mt-1" aria-controls="mp-1" aria-selected="true" tabindex="0">Holdings</button><button role="tab" id="mt-2" aria-controls="mp-2" aria-selected="false" tabindex="-1">Coins I launched</button></div>
  <div class="tabpanel" role="tabpanel" id="mp-1" aria-labelledby="mt-1">${holdRows}</div><div class="tabpanel" role="tabpanel" id="mp-2" aria-labelledby="mt-2" hidden>${launchedRows}</div></div>`;
  wireTabs($("#metabs"));
  $("#me-dis").onclick = async () => { try { const p = walletProvider(); if (p && p.disconnect) await p.disconnect(); } catch (e) {} setMe(null); toast("Wallet disconnected"); };
}

// ---------- launch ----------
const L = { step: 1, picks: [], target: null };
const MAX_PICKS = 3;
let pendingPicks = null;
function comboFor(picks) {
  if (picks.length < 2) return null;
  const key = comboKey(picks), have = S.combos.find(c => c.id === key);
  if (have) return have;
  const gs = key.split("+").map(id => S.games.find(g => g.id === id)).filter(Boolean);
  return { id: key, kind: "combo", games: key.split("+"), name: gs.map(g => g.name).join(" x "), idea: "", open: true, suggested: false, coin: null };
}
function setPicks(p) { L.picks = [...new Set(p)].slice(0, MAX_PICKS); L.target = L.picks.length >= 2 ? comboKey(L.picks) : null; setErr("game", ""); renderGlist(); preview(); saveDraft(); }
function renderGlist() {
  const s = $("#gsearch").value.trim().toLowerCase();
  const sug = S.combos.filter(c => c.suggested && c.open && !c.coin);
  $("#sugg").innerHTML = sug.length ? sug.map(c => `<button type="button" class="pill${L.target === c.id ? " dark" : ""}" data-combo="${esc(c.id)}">${esc(c.name)}</button>`).join("") : `<span class="hintx">No suggestions right now. Pick any games below.</span>`;
  const list = S.games.filter(g => g.open && (!s || (g.name + " " + plat(g.platform).l).toLowerCase().includes(s))).sort((a, b) => a.name.localeCompare(b.name));
  const full = L.picks.length >= MAX_PICKS;
  $("#glist").innerHTML = list.length ? list.map((g, i) => {
    const id = "go-" + i, on = L.picks.includes(g.id);
    return `<div class="gopt${on ? " on" : ""}"><label for="${id}"><input type="checkbox" name="pick" id="${id}" value="${esc(g.id)}" ${on ? "checked" : ""} ${!on && full ? "disabled" : ""}>${icon(g, "stk xs")}<span class="pl">${esc(plat(g.platform).l)}</span><span>${esc(g.name)}</span></label>${g.combos ? `<span class="lv">In ${g.combos} combo${g.combos > 1 ? "s" : ""}</span>` : ""}</div>`;
  }).join("") : `<div class="empty small"><b>Nothing by that name</b><span>Only approved games can be combined.</span></div>`;
  const c = comboFor(L.picks);
  $("#picked").innerHTML = !L.picks.length ? `<span class="hintx">Pick 2 or 3 games. Each combo gets one coin.</span>`
    : L.picks.length === 1 ? `<span><b>${esc((S.games.find(g => g.id === L.picks[0]) || {}).name || "")}</b> <span class="hintx">+ pick 1 or 2 more</span></span>`
    : c.coin ? `<span><b>${esc(c.name)}</b> already has a coin · <a href="#game-${esc(c.id)}">View $${esc(c.coin.t)}</a></span>`
    : `<span><b>${esc(c.name)}</b> <span class="hintx">· ${c.suggested ? "suggested combo" : "new combo"}, ready to launch</span></span>`;
}
$("#gsearch").oninput = renderGlist;
$("#glist").onchange = e => { if (e.target.name !== "pick") return; const v = e.target.value; setPicks(e.target.checked ? [...L.picks, v] : L.picks.filter(x => x !== v)); };
$("#sugg").onclick = e => { const b = e.target.closest("[data-combo]"); if (b) setPicks(b.dataset.combo.split("+")); };
const F = { name: $("#lf-name"), tick: $("#lf-tick"), img: $("#lf-img"), x: $("#lf-x"), desc: $("#lf-desc") };
F.ai = $("#lf-ai");
const aiPick = () => Math.min(100, Math.max(25, Math.round(+F.ai.value || 50)));
function showAi() {
  const ai = aiPick(), sh = shares(ai);
  $("#lf-ai-out").textContent = ai + "%";
  $("#lf-ai-break").innerHTML = `${splitBar(ai)}<span class="hintx">Out of every 1 SOL in fees: <b>${(sh.compute / 100).toFixed(3)} SOL</b> AI · <b>0.100 SOL</b> $CONSOLE buyback · <b>${(sh.dev / 100).toFixed(3)} SOL</b> to you</span>`;
}
F.ai.oninput = () => { showAi(); saveDraft(); };
// Remember the form (not the image file) so leaving the page doesn't lose the work.
function saveDraft() { try { localStorage.setItem("console-draft", JSON.stringify({ picks: L.picks, name: F.name.value, tick: F.tick.value, desc: F.desc.value, x: F.x.value, ai: F.ai.value })); } catch (e) {} }
function loadDraft() {
  let d = null; try { d = JSON.parse(localStorage.getItem("console-draft") || "null"); } catch (e) {}
  if (!d) return;
  F.name.value = String(d.name || "").slice(0, 32); F.tick.value = String(d.tick || "").slice(0, 10); F.desc.value = String(d.desc || "").slice(0, 500); F.x.value = String(d.x || "").slice(0, 80);
  if (d.ai) F.ai.value = d.ai;
  if (Array.isArray(d.picks) && d.picks.length && !pendingPicks) pendingPicks = d.picks.filter(x => S.games.some(g => g.id === x));
  showAi();
}
function clearDraft() { try { localStorage.removeItem("console-draft"); } catch (e) {} }
showAi();
function setErr(k, m) { const e = $("#e-" + k); if (!e) return !m; e.textContent = m; e.hidden = !m; if (F[k]) F[k].setAttribute("aria-invalid", m ? "true" : "false"); return !m; }
const squash = s => String(s).replace(/\s*\([^)]*\)\s*/g, " ").toLowerCase().replace(/[^a-z0-9]/g, "");
function titlesFor(t) { return t ? [t.name, ...gamesOf(t).map(g => g.name)] : []; }
function vName() { const v = F.name.value.trim(); if (!v) return setErr("name", "Add a coin name."); const hit = titlesFor(comboFor(L.picks)).find(x => squash(x).length >= 4 && squash(v).includes(squash(x))); return setErr("name", hit ? `Use an original name. "${hit}" is a game's title.` : ""); }
function vTick() { return setErr("tick", F.tick.value.trim().length < 2 ? "Add a ticker with 2 to 10 letters or numbers." : ""); }
function vImg() { const f = F.img.files[0]; if (!f) return setErr("img", "Add an image. pump.fun needs one."); if (f.size > 2 * 1024 * 1024) return setErr("img", "That image is over 2 MB. Pick a smaller one."); if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return setErr("img", "Use a PNG, JPG, GIF or WebP image."); return setErr("img", ""); }
function vX() { const v = F.x.value.trim(); return setErr("x", v && !/^(https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/status\/\d+)?\/?|@?[A-Za-z0-9_]{1,15})$/.test(v) ? "Use an @handle or an x.com link." : ""); }
F.name.onblur = vName; F.tick.onblur = vTick; F.x.onblur = vX;
F.tick.oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (!$("#e-tick").hidden) vTick(); preview(); saveDraft(); };
F.name.oninput = () => { if (!$("#e-name").hidden) vName(); preview(); saveDraft(); };
F.x.oninput = () => { if (!$("#e-x").hidden) vX(); saveDraft(); };
F.desc.oninput = saveDraft;
F.img.onchange = () => { if (!vImg()) { $("#lf-pv").textContent = "?"; return; } const rd = new FileReader(); rd.onload = () => { $("#lf-pv").innerHTML = `<img alt="" src="${esc(rd.result)}">`; }; rd.readAsDataURL(F.img.files[0]); };
function preview() {
  const t = comboFor(L.picks) || comboFor(S.games.slice(0, 2).map(g => g.id));
  if (!t) { $("#pv").innerHTML = ""; return; }
  $("#pv").innerHTML = cart(t, { preview: { t: F.tick.value || "TICKER", n: F.name.value.trim() || "Your coin" } });
}
function lfWallet() {
  const el = $("#lf-wallet"); if (!el) return;
  el.innerHTML = ME ? `<span>Launching from <b class="mono">${esc(shortW(ME))}</b>. Your wallet signs and pays about 0.03 SOL.</span>` : `<span>Your own wallet signs the launch. Console never holds your funds.</span><button type="button" class="btn sm" id="lf-connect">Connect wallet</button>`;
  const b = $("#lf-connect"); if (b) b.onclick = () => connectWallet($("#lf-msg"));
}
function goStep(n, focus = true) {
  if (n > L.step) {
    if (L.step === 1 && !L.target) { setErr("game", "Pick 2 or 3 games to combine."); return; }
    if (L.step === 1 && comboFor(L.picks).coin) { setErr("game", "That combo already has a coin. Change one of the games."); return; }
    if (L.step === 2 || n === 3) { const ok = [vName(), vTick(), vImg(), vX()]; const bad = ["name", "tick", "img", "x"][ok.indexOf(false)]; if (bad) { F[bad].focus(); return; } }
  }
  L.step = n;
  $$(".lstep").forEach(s => s.hidden = +s.dataset.step !== n);
  $$("#stepper li").forEach(li => { const s = +li.dataset.s; li.classList.toggle("done", s < n); if (s === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current"); });
  if (n === 3) {
    const t = comboFor(L.picks);
    $("#review").innerHTML = `<dt>Combo</dt><dd>${esc(t.name)}${t.suggested ? "" : ""}</dd><dt>Games</dt><dd>${esc(gamesOf(t).map(g => g.name + " (" + plat(g.platform).l + ")").join(" + "))}</dd><dt>Coin</dt><dd>${esc(F.name.value.trim())}</dd><dt>Ticker</dt><dd class="mono">$${esc(F.tick.value)}</dd><dt>Fees to AI</dt><dd>${aiPick()}% (locked after launch)</dd><dt>Launches on</dt><dd>pump.fun</dd>`;
    $("#lf-split").innerHTML = splitBar(aiPick()); $("#lf-splittext").textContent = "Creator fees go to the coin's own Console pool wallet, then split: " + splitText(aiPick()).replace("to the dev", "to you") + ". Paid out each time the pool reaches " + S.thresholdSol + " SOL.";
    $("#do-launch").textContent = `Launch $${F.tick.value} on pump.fun`;
    lfWallet(); $("#lf-msg").textContent = ""; $("#lf-msg").className = "msg";
  }
  if (focus) { const h = document.querySelector(`.lstep[data-step="${n}"] h2`); h.tabIndex = -1; h.focus(); }
}
$$("[data-next]").forEach(b => b.onclick = () => goStep(+b.dataset.next));

// Checks the transaction the server built before your wallet ever sees it: your wallet pays, and the only
// instructions are compute-budget settings plus exactly one pump.fun "create coin". Nothing else can be added.
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111", PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const CREATE_V2 = [214, 144, 76, 236, 95, 139, 49, 180];
function checkLaunchTx(vtx, me) {
  const msg = vtx.message, keys = (msg.staticAccountKeys || msg.accountKeys || []).map(k => String(k));
  if (!keys.length || keys[0] !== me) return "This launch isn't set up to be paid by your wallet, so we stopped it.";
  if (msg.addressTableLookups && msg.addressTableLookups.length) return "This launch uses an unexpected account lookup, so we stopped it.";
  const ix = msg.compiledInstructions || msg.instructions || [];
  let creates = 0;
  for (const i of ix) {
    const pid = keys[i.programIdIndex], d = Array.from(i.data || []);
    if (pid === COMPUTE_BUDGET) { if (d[0] !== 2 && d[0] !== 3) return "This launch includes an unexpected setting, so we stopped it."; continue; }
    if (pid === PUMP && CREATE_V2.every((b, k) => d[k] === b)) { creates++; continue; }
    return "This launch includes an unexpected instruction, so we stopped it before your wallet opened.";
  }
  if (creates !== 1) return "This launch doesn't look like a single pump.fun coin creation, so we stopped it.";
  return null;
}
const b64u8 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
let web3P = null;
function loadWeb3() { if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3); web3P = web3P || new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.3/lib/index.iife.min.js"; sc.onload = () => window.solanaWeb3 ? ok(window.solanaWeb3) : no(new Error("web3")); sc.onerror = () => { web3P = null; no(new Error("web3")); }; document.head.appendChild(sc); }); return web3P; }

$("#do-launch").onclick = async () => {
  const m = $("#lf-msg"), go = $("#do-launch"), t = comboFor(L.picks);
  const say = (txt, cls) => { m.className = "msg" + (cls ? " " + cls : ""); m.textContent = txt; };
  if (CONFIG.demo) { say("Example mode: this is where your wallet would open to sign the launch. Nothing was sent."); return; }
  if (!S.launchesOpen) { say("Launches open soon. Your details are ready, so come back on launch day.", "err"); return; }
  if (!t || t.coin) { say("That combo already has a coin. Change one of the games.", "err"); goStep(1); return; }
  const prov = walletProvider();
  if (!prov) { if (openInWalletApp()) return; say("No Solana wallet found in this browser. Open Console in Phantom, Solflare or Backpack.", "err"); return; }
  go.disabled = true;
  try {
    say("Approve the connection in your wallet…");
    const c = await prov.connect(); const me = String((c && c.publicKey) || prov.publicKey); if (me !== ME) setMe(me);
    say("Preparing your launch…");
    const fd = new FormData();
    fd.append("target", t.id); fd.append("name", F.name.value.trim()); fd.append("ticker", F.tick.value.trim()); fd.append("description", F.desc.value.trim()); fd.append("twitter", F.x.value.trim()); fd.append("creator", me); fd.append("aiPct", String(aiPick())); fd.append("image", F.img.files[0]);
    const r = await fetch(CONFIG.api + "/launch", { method: "POST", body: fd }); const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error || typeof j.tx !== "string" || !isAddr(j.mint)) throw { stage: "prep", msg: j.error ? String(j.error).slice(0, 160) : "" };
    const W3 = await loadWeb3().catch(() => { throw { stage: "web3" }; });
    const vtx = W3.VersionedTransaction.deserialize(b64u8(j.tx));
    const bad = checkLaunchTx(vtx, me); if (bad) throw { stage: "check", msg: bad };
    say("Approve the launch in your wallet. It shows exactly what you'll pay.");
    const res = await prov.signAndSendTransaction(vtx); const sig = (res && res.signature) || res;
    say("Confirming on Solana…");
    await fetch(CONFIG.api + "/launch/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mint: j.mint, signature: String(sig), creator: me }) }).catch(() => {});
    clearDraft();
    say(`$${F.tick.value} is live. Opening its page…`, "ok");
    await loadState(); setTimeout(() => { location.hash = "#game-" + t.id; }, 900);
  } catch (err) {
    say(err && err.code === 4001 ? "You cancelled in your wallet. Nothing was charged."
      : err && err.stage === "prep" ? (err.msg || "We couldn't prepare the launch. Nothing was charged. Try again in a minute.")
      : err && err.stage === "check" ? err.msg + " Nothing was charged."
      : err && err.stage === "web3" ? "A wallet helper didn't load. Check your connection and try again. Nothing was charged."
      : "The launch didn't go through. If your wallet shows a sent transaction, check My coins before trying again. Otherwise press Launch to try again.", "err");
    go.textContent = `Try again: launch $${F.tick.value}`;
  } finally { go.disabled = false; }
};



// ---------- router ----------
const VIEWS = ["explore", "live", "pools", "launch", "me", "rules", "game"];
let first = true;
function route() {
  const h = decodeURIComponent(location.hash.slice(1)) || "explore";
  let view = h, target = null;
  current.game = null;
  if (h.startsWith("game-")) { view = "game"; current.game = h.slice(5); }
  else if (!VIEWS.includes(h)) { target = document.getElementById(h); view = (target && target.closest("[data-view]") && target.closest("[data-view]").dataset.view) || "explore"; }
  stopMatcher();
  $$("[data-view]").forEach(s => s.hidden = s.dataset.view !== view);
  $$("[data-nav]").forEach(a => { if (a.dataset.nav === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (view === "game") renderGame(byId(current.game));
  if (view === "me") renderMe();
  if (view === "live") { activeMatcher = Matcher($("#live-mv")); activeMatcher.run(); }
  if (view === "launch") { lfWallet(); if (pendingPicks) { const p = pendingPicks; pendingPicks = null; L.step = 1; goStep(1, false); setPicks(p); } }
  $("#buybar").hidden = view !== "game"; document.body.classList.toggle("has-buybar", view === "game");
  if (target) target.scrollIntoView({ block: "start" }); else if (!first) window.scrollTo(0, 0);
  if (!first) { const hd = target ? null : document.querySelector(`[data-view="${view}"] h1`); const el = hd || target; if (el && el.focus) el.focus({ preventScroll: !!target }); }
  first = false;
}
addEventListener("hashchange", route);

document.addEventListener("keydown", e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (e.key === "Escape") $$(".q .tip").forEach(t => t.hidden = true);
  if (typing) return;
  if (e.key === "/" && !$("[data-view=explore]").hidden) { e.preventDefault(); $("#q").focus(); }
  if ((e.key === "a" || e.key === "A") && (document.activeElement.classList.contains("tcard") || document.activeElement.classList.contains("ccard"))) { e.preventDefault(); document.activeElement.click(); }
  if ((e.key === "b" || e.key === "B" || e.key === "Escape") && !$("[data-view=game]").hidden) { e.preventDefault(); location.hash = "#explore"; }
});

let tt; function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2600); }

renderWallet(); lfWallet();
loadState().then(() => { loadDraft(); route(); loadMe(); });
if (!CONFIG.demo) setInterval(() => { if (!document.hidden) loadState(); }, CONFIG.refreshMs);
