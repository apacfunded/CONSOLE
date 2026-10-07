# Go-live checklist

Plain steps, in order. Nothing here needs code. Full details on each variable are in [SETUP.md](SETUP.md).

## 1. Put the code on GitHub
1. On github.com, create an empty repository called **CONSOLE** (no README, no license).
2. Upload this project to it (or ask Claude to push it once the repo exists).
3. Check the **Actions** tab shows "test" passing after the upload.

## 2. Create the database
1. Make a **new** Supabase project (not Exposure's).
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, run it once.
3. In **Project settings → API**, copy the **Project URL** and the **service_role** key. Never share the service_role key.

## 3. Make the wallets and secrets
1. Make two Solana wallets you control: one for **AI compute**, one for **buyback and burn**. Copy their public addresses.
2. On your own computer, make two secrets. Store them somewhere safe and offline:
   - `POOL_MASTER_SEED`: 64 hex characters. Whoever has this controls every coin's pool wallet.
   - `CRON_SECRET`: 40+ random characters.
3. Get a Helius (or any Solana) RPC URL and a Pinata upload JWT.

## 4. Deploy on Vercel
1. Create a new Vercel project from the CONSOLE repo. Framework: **Other**. It deploys as is.
2. In **Settings → Environment Variables (Production)** add everything in the SETUP.md table. Leave `LAUNCHES_ENABLED` and `PAYOUTS_ENABLED` **unset** for now.
3. Set `SITE_URL` to your real domain (with https://). This is baked into every coin's pump.fun page and can't be changed afterwards for coins already launched.
4. Redeploy. Open `yourdomain.com/api/health`: every `env` entry should be `true` and `games.problems` should be empty.
5. In GitHub → **Settings → Secrets and variables → Actions**, add `SITE_URL` and `CRON_SECRET` (same values as Vercel). This turns on the background jobs.

## 5. Test with one coin
1. In Vercel set `LAUNCHES_ENABLED=1` and redeploy. The "launches open soon" banner disappears.
2. From your own wallet, launch one combo coin on the live site. Trade a little on pump.fun.
3. GitHub → Actions → **jobs** → Run workflow → `claim`. Then check the coin's pool received fees: `yourdomain.com/api/health?coin=MINT` (your browser needs to send the cron secret; easiest is to run the `claim` workflow and look at the Pools page).
4. Watch two or three **payout** dry runs in the Actions log. They say what would be sent, with `dryRun: true`.

## 5b. AI tasks (optional, but this is what the site's "AI work" tab shows)
1. A coin earns one task per 1 SOL of trading volume. Volume is estimated from fees, so first check `CREATOR_FEE_BPS` matches pump.fun's current creator fee (default 30 = 0.30%).
2. **To have an AI run them:** add `ANTHROPIC_API_KEY` in Vercel and redeploy. The `work` job (every 10 minutes) runs up to `WORK_PER_RUN` tasks per run and `DAILY_TASK_CAP` per day, so your spend has a ceiling. Check the first few results on a coin's AI work tab.
3. **To do them yourself instead:** leave the key unset. Tasks stay "queued, waiting for the team". Do the work, then GitHub → Actions → **post task** → Run workflow → paste the coin address, the task number and a one-sentence summary. It shows as "Done by the Console team".
4. Databases made before this version need `supabase/migrations/2026-10-07-ai-tasks.sql` run once.

## 6. Turn on real payouts last
1. Only when the dry runs look right: set `PAYOUTS_ENABLED=1` in Vercel and redeploy.
2. After the first real split, open the Pools page and click "view" on a payout to see it on Solscan.

## When you burn $CONSOLE
1. Buy $CONSOLE with the buyback wallet and burn it, by hand.
2. GitHub → Actions → **record burn** → Run workflow → paste the burn transaction's signature, the tokens burned, and the SOL spent. It shows on the Pools page.

## If something goes wrong
- `PAUSED=1` in Vercel stops launches and payouts on the next request.
- A failed payout stops that coin and waits for you. Look at `payout_rounds` in Supabase, fix the cause, then set that round's status to `done` or `failed` by hand.
