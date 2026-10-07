// Current market cap in USD: pump.fun bonding curve for coins still on the curve, DexScreener after graduation.
import { curveMarketCaps } from "./chain.js";

export const solUsd = () => fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd").then(r => r.json()).then(j => +j.solana.usd || 0).catch(() => 0);

// DexScreener (free, no key). Up to 30 mints per call.
export async function dexMarketCaps(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    const pairs = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`).then(r => r.json()).catch(() => []);
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const m = p && p.baseToken && p.baseToken.address, mc = +(p.marketCap || p.fdv || 0);
      if (m && mc > 0 && (!out[m] || mc > out[m])) out[m] = mc;
    }
  }
  return out;
}

export async function currentMcUsd(mints) {
  if (!mints.length) return {};
  const [px, curve] = await Promise.all([solUsd(), curveMarketCaps(mints).catch(() => ({}))]);
  const out = {};
  for (const [m, v] of Object.entries(curve)) if (!v.complete && px) out[m] = Math.round(v.mcSol * px);
  const rest = mints.filter(m => !(m in out));
  if (rest.length) Object.assign(out, await dexMarketCaps(rest).catch(() => ({})));
  return out;
}
