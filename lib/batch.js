// Small helpers for background jobs that must finish inside one serverless call.
// pmap runs `fn` over `items` with at most `limit` in flight. budget() says when to stop and let the next run continue.

export async function pmap(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = { error: String((e && e.message) || e).slice(0, 200) }; } } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// A job may run for at most `ms` (default 40s: Vercel functions are capped at 60s in vercel.json).
export function budget(ms = Number(process.env.JOB_BUDGET_MS) || 40_000) {
  const t0 = Date.now();
  return { spent: () => Date.now() - t0, over: () => Date.now() - t0 > ms };
}

// How many coins one claim run looks at. Every run takes the coins claimed longest ago, so all coins are reached in turn.
export const claimPageSize = () => { const n = Number(process.env.CLAIM_PAGE_SIZE || 40); return Number.isFinite(n) && n >= 1 ? Math.min(500, Math.floor(n)) : 40; };
