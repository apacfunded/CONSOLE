// The approved games and combos, read from games.json at the repo root (the owner edits that file).
// Everything a launch is allowed to target comes from here; the server never trusts a game name from the browser.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_NAMES } from "./icons.js";

export const PLATFORMS = ["N64", "PS1", "GBA", "PS2", "PS3", "PS4", "X360", "PC"];
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const MAX_COMBO = 3;
// A combo's id is its game ids, sorted, joined with "+". The same set of games is always the same combo.
export const comboKey = ids => [...new Set(ids)].sort().join("+");

export function validate(raw) {
  const errors = [], games = [], combos = [], ids = new Set();
  for (const g of (raw && raw.games) || []) {
    if (!ID.test(g.id || "")) { errors.push(`game id "${g.id}" must be lowercase letters, numbers and dashes`); continue; }
    if (ids.has(g.id)) { errors.push(`id "${g.id}" is used twice`); continue; }
    if (!g.name || String(g.name).length > 48) { errors.push(`game "${g.id}" needs a name up to 48 characters`); continue; }
    if (!PLATFORMS.includes(g.platform)) { errors.push(`game "${g.id}" platform must be one of ${PLATFORMS.join(", ")}`); continue; }
    ids.add(g.id);
    const stage = Math.min(5, Math.max(1, Math.round(+g.stage || 1))), pct = Math.min(100, Math.max(0, +g.pct || 0));
    games.push({ id: g.id, name: String(g.name), platform: g.platform, icon: ICON_NAMES.includes(g.icon) ? g.icon : "pad", open: g.open !== false, stage, pct, functions: Math.max(0, Math.round(+g.functions || 0)), repo: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(g.repo || "") ? g.repo : "" });
  }
  const gameIds = new Set(games.map(g => g.id));
  for (const c of (raw && raw.combos) || []) {
    if (!ID.test(c.id || "")) { errors.push(`combo id "${c.id}" must be lowercase letters, numbers and dashes`); continue; }
    if (ids.has(c.id)) { errors.push(`id "${c.id}" is used twice`); continue; }
    const list = Array.isArray(c.games) ? [...new Set(c.games)] : [];
    if (list.length < 2 || list.length > MAX_COMBO) { errors.push(`combo "${c.id}" needs 2 to ${MAX_COMBO} games`); continue; }
    const missing = list.filter(x => !gameIds.has(x));
    if (missing.length) { errors.push(`combo "${c.id}" lists games that don't exist: ${missing.join(", ")}`); continue; }
    if (!c.name || String(c.name).length > 40) { errors.push(`combo "${c.id}" needs a name up to 40 characters`); continue; }
    ids.add(c.id);
    combos.push({ id: comboKey(list), name: String(c.name), games: comboKey(list).split("+"), idea: String(c.idea || "").slice(0, 160), open: c.open !== false });
  }
  return { games, combos, errors };
}

let cache = null;
export function catalog() {
  if (cache) return cache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(fs.readFileSync(path.join(here, "..", "games.json"), "utf8"));
  cache = validate(raw);
  if (cache.errors.length) console.error("games.json problems:", cache.errors);
  return cache;
}

// Coins are launched for combos only: 2 or 3 different open games from games.json, given as their canonical key.
// A combo the owner suggested in games.json keeps its name and idea; any other gets "Game A x Game B".
export function findTarget(key) {
  const { games, combos } = catalog();
  const parts = String(key || "").split("+");
  if (parts.length < 2 || parts.length > MAX_COMBO || comboKey(parts) !== key) return null;
  const gs = parts.map(id => games.find(g => g.id === id && g.open));
  if (gs.some(g => !g)) return null;
  const suggested = combos.find(c => c.id === key);
  if (suggested && !suggested.open) return null;
  return { kind: "combo", id: key, games: parts, gameNames: gs.map(g => g.name), name: suggested ? suggested.name : gs.map(g => g.name).join(" x "), idea: suggested ? suggested.idea : "" };
}

// The page on Console for one combo. Each coin's pump.fun "website" link points here.
export function targetUrl(site, id) {
  const base = String(site || "").replace(/\/+$/, "");
  return base ? `${base}/#game-${encodeURIComponent(id)}` : undefined;
}
