# Changelog

## AI work feed (October 2026)

### Added
- **AI work tab on every coin.** One task unlocks for every 1 SOL of trading volume (`TASK_EVERY_SOL`). The tab shows a meter to the next unlock, counts, and a live feed of tasks: queued, running, done or failed, who did each (the AI and which model, or the Console team) and the result. Combo cards show "AI tasks 3 done · next at 4 SOL".
- **Task worker** (`/api/cron/work`, every 10 minutes). Runs queued tasks with an AI model when `ANTHROPIC_API_KEY` is set. Spend is capped (`WORK_PER_RUN`, `DAILY_TASK_CAP`), a failed task is tried 3 times then marked failed, and a task stuck "running" goes back in the queue.
- **Post a result by hand.** Owner-only `/api/admin/task` and a GitHub Action "post task", for tasks you or your own AI did.
- Public `/api/tasks?mint=` feed; `tasks` table and per-coin counters (migration `2026-10-07-ai-tasks.sql`).
- 5 new tests (26 total): unlock math, no duplicate tasks, worker off without a key, daily cap, retry then give up, owner-only posting, feed and state.

### How it stays honest
- A task is "queued" until something has really run it. Nothing is animated or simulated on a live coin.
- The AI is told it has no game files, must say when unsure, and must not claim it decompiled or tested anything. Its output is notes and plans from public knowledge. The page says so, and says the Progress tab is separate.
- **Volume is an estimate.** pump.fun doesn't give a running volume total, so it is derived from creator fees claimed: fees / `CREATOR_FEE_BPS`. Set that to pump.fun's current creator fee. Partial claims and fee changes make it approximate.

### Not tested here
- The real Anthropic call (the tests use a stand-in). Test: set the key, trade a test coin past 1 SOL, run the `work` workflow, read the result.
- Volume accuracy against real trades. Test: compare a coin's "SOL volume" with pump.fun's chart after some trading.

## Review pass (October 2026)

### Fixed
- **Honest progress wording.** The site no longer says progress "can't be faked" or is "compiler output". It now says progress is posted by the Console team from build results, which is what actually happens (numbers in `games.json`).
- **One bar on phone game pages.** The floating Buy bar used to sit on top of the bottom nav. On a coin's page the bottom nav is now replaced by one bar: back arrow, ticker and market cap, Buy button.
- **Background jobs can't time out.** The fee-claim job now works on a page of coins per run (default 40, oldest-claimed first, 4 at once) and stops at a 40-second budget, so with many coins every one is still reached in turn. Launch confirmation checks run 6 at a time. The payout job keeps every safety rule unchanged and only gained a time budget.
- **Games page is much shorter.** Combos now come first. The games grid shows 9 (desktop) or 4 (phone) with "Show all"; combos show 4 on phones with "Show all".
- **Hero tiles.** Smaller, numbers never wrap. On launch day they show games, suggested combos, the 10% burn and the split threshold instead of four zeros.
- **"Closest to done" on launch day** now lists suggested combos with a "Launch this combo" button instead of an empty box.
- **The dev's AI share is visible everywhere.** An "AI 60%" pill on every live combo card, a "100% to AI" filter and "Highest AI share" sort on the Combos section, and on the launch review.
- **Rules page** has a "Where the money goes" panel: the split, who controls the AI compute wallet, that burns are manual and recorded.
- **Launch page** "Why this is allowed" now says "This isn't legal advice."
- **Burns are recorded.** New owner-only endpoint `/api/admin/burn` (cron-secret protected, checks the transaction on chain, never records twice) and a GitHub Action "record burn" to call it without code. The Pools page shows "$CONSOLE burned" and a Burns ledger.
- **"My coins" spacing** and other 4/8px rhythm fixes.
- **Schema upgrade path.** `supabase/migrations/` with a README for databases made from an older schema.
- **Pools totals.** "Sent to buyback" now sums the payouts table instead of the last 60 activity rows.
- `docs/SETUP.md`: the confusing "launchers don't receive creator fees" line is reworded; new optional variables documented.

### Improved
- Launch form remembers what you typed (not the image) if you leave and come back; cleared after a successful launch.
- Review step shows "What your wallet will sign": one transaction, about 0.03 SOL, no dev buy.
- Launch errors say what to do next and the button becomes "Try again".
- AI slider explains its 50% default in one line.
- Hero has a plain one-sentence explanation and a "How it works" link.
- Game cards have a subtle original pattern per platform so 25 cards scan faster. No logos or game art anywhere.
- Trust signals: "fees last claimed X ago" on the Pools page and on each coin's Fees tab; every payout and burn links to Solscan.
- Tap targets: chips, tabs, suggested-combo pills and the "?" tip button are 44px; checkboxes are larger.
- Loading skeletons for the Combos panel.

### Left alone, and why
- **The AI pipeline.** Progress still comes from `games.json`. Building a real pipeline is a separate project; the copy is now honest about it.
- **web3.js from jsDelivr.** Still loaded from the CDN for signing. Host it yourself before a big launch (noted in SETUP.md).
- **Dev buy at launch.** Still off on purpose.
- **Payout safety rules.** Unchanged: unique round per coin, stop on first failure, run cap, dry run unless `PAYOUTS_ENABLED=1`.
- **Wallet-side transaction check, one-coin-per-combo lock, chain verification of launches, kill switches, cron-secret protection.** All unchanged and still covered by tests.

### Not tested here (and how you can)
- **Real wallet signing.** The container can't load the web3 script or a wallet. Test: on the live site with `LAUNCHES_ENABLED=1`, launch one coin from your own wallet with 0.05 SOL in it.
- **Real fee claims and payouts on mainnet.** Test: trade the test coin, run the `claim` workflow, watch `payout` dry runs, then turn on `PAYOUTS_ENABLED`.
- **The record-burn Action end to end.** Test: do one small burn, run the workflow, check the Pools page.
- **Supabase migration on an old database.** The SQL is standard and safe to re-run, but it has only been checked against the schema, not a live old database.
