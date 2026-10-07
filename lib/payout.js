// Fee split math. Pure functions only, so it can be tested without a chain or a database.
// 10% of every pool buys back and burns $CONSOLE. The coin's dev picked, at launch, what share of the
// other 90% pays for AI work on the combo (25 to 100%). Whatever is left goes to the dev's wallet.
export const LAMPORTS = 1_000_000_000;
export const BUYBACK_PCT = 10, AI_MIN = 25, AI_MAX = 100;
export const SPLIT = { buybackPct: BUYBACK_PCT, aiMin: AI_MIN, aiMax: AI_MAX };
export const MIN_SEND_LAMPORTS = 1_000_000; // never send dust under 0.001 SOL
export const validAiPct = p => Number.isInteger(p) && p >= AI_MIN && p <= AI_MAX;

// Share of all fees each side gets, in percent, for a dev's AI pick.
export const shares = aiPct => ({ buyback: BUYBACK_PCT, compute: +((100 - BUYBACK_PCT) * aiPct / 100).toFixed(1), dev: +((100 - BUYBACK_PCT) * (100 - aiPct) / 100).toFixed(1) });

export const thresholdLamports = () => {
  const sol = Number(process.env.PAYOUT_THRESHOLD_SOL || "0.5");
  return Math.round((Number.isFinite(sol) && sol >= 0.05 ? sol : 0.5) * LAMPORTS);
};

// Returns null until the pool reaches the threshold (or if the AI share is invalid).
// Otherwise up to three sends that add up to exactly the pool.
export function planSplit(poolLamports, aiPct, threshold = thresholdLamports()) {
  poolLamports = Math.floor(Number(poolLamports));
  if (!validAiPct(aiPct)) return null;
  if (!Number.isFinite(poolLamports) || poolLamports < threshold || poolLamports < 3 * MIN_SEND_LAMPORTS) return null;
  const buyback = Math.floor(poolLamports * BUYBACK_PCT / 100);
  const rest = poolLamports - buyback;
  let compute = Math.floor(rest * aiPct / 100), dev = rest - compute;
  if (dev > 0 && dev < MIN_SEND_LAMPORTS) { compute += dev; dev = 0; } // dust goes to the AI instead
  return { compute, buyback, dev, aiPct, total: poolLamports };
}
