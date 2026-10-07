# Console — going live

The site (`public/`) and the backend (`api/`) deploy together on Vercel from this repo.

## What runs where
| Piece | Where |
|---|---|
| Website + API | Vercel |
| Jobs (tick every 5 min, claim every 30 min, fee split every 15 min) | GitHub Actions → `/api/cron/*` |
| Database | A new Supabase project (`supabase/schema.sql`), not Exposure's |
| Chain reads | Helius or any Solana RPC |
| Coin images + metadata | Pinata (IPFS) |

## How the money moves
- Every coin gets its **own pool wallet**, derived from `POOL_MASTER_SEED`. It is set as the coin's pump.fun creator, so all creator fees land in that pool wallet (not in the launcher's wallet). The launcher is paid their dev share from the pool when it splits.
- The claim job sweeps pump.fun's creator vault into the pool wallet.
- Once a pool holds `PAYOUT_THRESHOLD_SOL` (default 0.5), the split job sends 10% to `BUYBACK_WALLET`, then splits the other 90% between `COMPUTE_WALLET` and the launcher's own wallet using the AI share (25 to 100%) the launcher picked at launch. That pick is stored with the coin and can't be changed.
- Buyback and burn is manual for now: buy $CONSOLE with the buyback wallet and burn it. Then record it so the site shows it: GitHub → Actions → **record burn** → Run workflow → paste the burn transaction's signature, the token amount and the SOL spent. It appears on the Pools page under Burns.
- A round can't be sent twice. If a send fails, that coin stops and waits for you.
- `PAUSED=1` stops launches and payouts immediately. `PAYOUTS_ENABLED=1` is needed for real sends; otherwise the split job only reports what it would send.

## One coin per combo
A launch reserves its combo for 3 minutes (a Solana launch can't land later than that). A coin only counts as live once the chain shows pump.fun created it with its Console pool wallet as creator.

## Vercel environment variables (Production)
| Name | What |
|---|---|
| `SITE_URL` | `https://yourdomain.com` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | New Supabase project URL and its **service_role** key |
| `SOLANA_RPC_URL` | Helius mainnet RPC URL with your key |
| `POOL_MASTER_SEED` | 64 hex characters, **new**, not Exposure's. Back it up offline. Whoever has it controls every pool. |
| `CRON_SECRET` | 40+ random characters (also a GitHub Actions secret) |
| `PINATA_JWT`, `PINATA_GATEWAY` | Pinata upload JWT, optional gateway domain |
| `COMPUTE_WALLET`, `BUYBACK_WALLET` | Public addresses of two wallets you control (AI compute, and $CONSOLE buyback and burn) |
| `PAYOUT_THRESHOLD_SOL` | optional, default 0.5 |
| `MAX_PAYOUT_SOL_PER_RUN` | optional, default 5 |
| `ANTHROPIC_API_KEY` | optional. Turns on the AI worker: it runs the tasks coins earn. Without it, tasks stay "queued" on the site until you post a result by hand (see GO-LIVE.md). Cost comes from your Anthropic account |
| `TASK_MODEL` | optional, default `claude-sonnet-5-5` |
| `TASK_EVERY_SOL` | optional, default 1: SOL of trading volume that unlocks one task |
| `CREATOR_FEE_BPS` | optional, default 30 (= 0.30%): pump.fun's creator fee. Trading volume is estimated as fees collected divided by this, so **check it against pump.fun's current creator fee** or the volume (and task count) will be wrong |
| `WORK_PER_RUN` / `DAILY_TASK_CAP` | optional, default 2 and 30: the most AI tasks run per job run and per day. This is your spend limit |
| `CLAIM_PAGE_SIZE` | optional, default 40: how many coins one claim run looks at (oldest-claimed first, so every coin is reached in turn) |
| `JOB_BUDGET_MS` | optional, default 40000: a job stops after this many ms and the next run continues |
| `LAUNCHES_ENABLED` | `1` to open launches |
| `PAYOUTS_ENABLED` | `1` to send real splits |
| `PAUSED` | `1` = kill switch |

Generate secrets on your own computer: `openssl rand -hex 32` (POOL_MASTER_SEED) and `openssl rand -hex 24` (CRON_SECRET).

## Order to switch things on
1. Run `supabase/schema.sql` in the new Supabase project. (Already have a database from an older Console? Run the files in `supabase/migrations/` instead; see the README there.)
2. Edit `games.json` with your real games and combos. Push.
3. Add the Vercel env vars, leaving `LAUNCHES_ENABLED` and `PAYOUTS_ENABLED` unset. Redeploy.
4. Check `/api/health` shows every variable set and `games.problems` empty, and `/api/state` returns JSON.
5. `LAUNCHES_ENABLED=1`. Launch one test coin from your own wallet, trade a little, run the claim job by hand (Actions → jobs → Run workflow → `claim`) and check the fees reached the pool wallet (`/api/health?coin=MINT` with the cron secret).
6. Watch a few split dry runs. Only then `PAYOUTS_ENABLED=1`.

## Not finished
- Dev buy at launch is off (launchers can buy right after on pump.fun).
- Progress numbers (`stage`, `pct`, `functions`) are typed into `games.json` by you from build results. The site says so. Nothing on the site computes them.
- web3.js loads from jsDelivr; host it yourself before a big launch.
