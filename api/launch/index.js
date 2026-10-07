import { db, eq } from "../../lib/db.js";
import { isAddress } from "../../lib/keys.js";
import { send, allow, guard, sameOrigin, limited, paused } from "../../lib/http.js";
import { buildLaunchTx, verifyLaunched } from "../../lib/chain.js";
import { getBalance } from "../../lib/sol.js";
import { findTarget, targetUrl } from "../../lib/games.js";
import { validAiPct, AI_MIN, AI_MAX } from "../../lib/payout.js";

const MAX_BODY = 2.5 * 1024 * 1024, MAX_IMG = 2 * 1024 * 1024;

function imageType(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null; // SVG and everything else refused
}

async function pin(blob, filename) {
  const fd = new FormData(); fd.append("file", blob, filename); fd.append("network", "public");
  const r = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  const cid = j && j.data && j.data.cid;
  if (!r.ok || !cid) throw Object.assign(new Error("upload_failed"), { status: 502 });
  return `https://${(process.env.PINATA_GATEWAY || "gateway.pinata.cloud").replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/ipfs/${cid}`;
}

const squash = s => String(s).replace(/\s*\([^)]*\)\s*/g, " ").toLowerCase().replace(/[^a-z0-9]/g, ""); // "(story mode)" etc. ignored

// Prepares a launch for a combo of 2 or 3 approved games. Returns a transaction the launcher's own wallet signs and pays for.
// The coin's pump.fun creator is a pool wallet only Console controls, so every creator fee funds that game's work.
export default guard(async (req, res) => {
  if (!allow(req, res, "POST")) return;
  if (paused() || process.env.LAUNCHES_ENABLED !== "1") return send(res, 503, { error: "Launches aren't open yet." });
  if (!sameOrigin(req)) return send(res, 403, { error: "origin" });
  if (await limited(req, res, "launch", 5, 3600)) return;

  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(res, 413, { error: "The image is too big. Keep it under 2 MB." }); chunks.push(c); }
  const form = await new Request("http://x/", { method: "POST", headers: { "content-type": req.headers["content-type"] || "" }, body: Buffer.concat(chunks) }).formData().catch(() => null);
  if (!form) return send(res, 400, { error: "bad_form" });
  const f = k => String(form.get(k) || "").trim();

  const target = findTarget(f("target"));
  if (!target) return send(res, 400, { error: "Pick 2 or 3 different games from the approved list to combine." });
  const name = f("name"), ticker = f("ticker").replace(/^\$/, ""), description = f("description"), twitter = f("twitter"), creator = f("creator");
  if (!name || name.length > 32) return send(res, 400, { error: "Names can be up to 32 characters." });
  if (!/^[A-Za-z0-9]{2,10}$/.test(ticker)) return send(res, 400, { error: "Tickers are 2 to 10 letters or numbers." });
  // coin names must be original, never the game's own title
  const titles = [target.name, ...target.gameNames];
  if (titles.some(t => squash(t).length >= 4 && squash(name).includes(squash(t)))) return send(res, 400, { error: "Use an original name, not the game's title." });
  if (description.length > 500) return send(res, 400, { error: "Keep the description under 500 characters." });
  if (!isAddress(creator)) return send(res, 400, { error: "Connect your wallet first." });
  const aiPct = Number(f("aiPct"));
  if (!validAiPct(aiPct)) return send(res, 400, { error: `Pick between ${AI_MIN}% and ${AI_MAX}% of fees for the AI.` });
  if (twitter && !/^(https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/status\/\d+)?\/?|@?[A-Za-z0-9_]{1,15})$/.test(twitter)) return send(res, 400, { error: "That X link doesn't look right." });

  // launching costs ~0.025 SOL in rent + network fees
  const bal = await getBalance(creator).catch(() => null);
  if (bal !== null && bal < 30_000_000) return send(res, 400, { error: `Your wallet has ${(bal / 1e9).toFixed(3)} SOL. A launch needs about 0.03 SOL.` });

  // before uploading anything: is this game free? A pending launch that actually landed is confirmed now,
  // so a slow or missed confirm can never free the game for a second coin.
  const rows = await db.select("coins", `target=${eq(target.id)}&created_at=gt.${new Date(Date.now() - 864e5).toISOString()}&order=created_at.asc&limit=20`);
  for (const r of rows) {
    if (r.confirmed) return send(res, 409, { error: `${target.name} combo already has a coin. Pick a different combo.` });
    if (await verifyLaunched(r.mint).catch(() => false)) { await db.update("coins", `mint=${eq(r.mint)}`, { confirmed: true }).catch(() => {}); return send(res, 409, { error: `${target.name} combo already has a coin. Pick a different combo.` }); }
  }
  const mineOpen = await db.select("coins", `creator=${eq(creator)}&confirmed=eq.false&created_at=gt.${new Date(Date.now() - 180e3).toISOString()}&limit=1`);
  if (mineOpen.length) return send(res, 429, { error: "You already have a launch in progress. Finish it in your wallet or wait 3 minutes." });

  const img = form.get("image");
  if (!img || typeof img.arrayBuffer !== "function" || img.size > MAX_IMG) return send(res, 400, { error: "Add an image under 2 MB." });
  const bytes = new Uint8Array(await img.arrayBuffer()), type = imageType(bytes);
  if (!type) return send(res, 400, { error: "Images must be PNG, JPG, GIF or WebP." });

  const imageUrl = await pin(new Blob([bytes], { type }), "image");
  const tw = twitter ? (twitter.startsWith("http") ? twitter : "https://x.com/" + twitter.replace(/^@/, "")) : undefined;
  const meta = { name, symbol: ticker, description, image: imageUrl, showName: true, createdOn: process.env.SITE_URL, ...(tw ? { twitter: tw } : {}), website: targetUrl(process.env.SITE_URL, target.id) || process.env.SITE_URL };
  const uri = await pin(new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
  if (uri.length > 200) return send(res, 500, { error: "server" });

  const built = await buildLaunchTx({ user: creator, name, symbol: ticker, uri, devBuyLamports: 0 });
  // reserve the game atomically: one live coin per game or combo
  const ok = await db.rpc("insert_coin_if_free", { p_mint: built.mint, p_target: target.id, p_ticker: ticker, p_name: name, p_img: imageUrl, p_description: description, p_twitter: tw || null, p_creator: creator, p_pool_wallet: built.poolWallet, p_ai_pct: aiPct });
  if (!(ok === true || (Array.isArray(ok) && ok[0] === true))) return send(res, 409, { error: `${target.name} combo already has a coin, or someone is launching one right now. Pick a different combo.` });
  send(res, 200, { tx: built.tx, mint: built.mint });
});
