# Console

Your dream crossover, funded. A pump.fun launchpad where every coin is a combo of 2 or 3 games. 10% of its creator fees buys back and burns $CONSOLE, and the launcher picks how much of the rest (25 to 100%) pays for AI to rebuild those games; they keep the remainder.

Built on Exposure's proven launch and fee plumbing, with its own wallets and database.

**Never commit secrets.** Wallet seeds and API keys go in Vercel project settings (Environment Variables) only.

## Layout
- `games.json` the approved games and combos. Edit this to add games or combos (instructions inside).
- `public/` the website, `api/` backend (Vercel functions), `lib/` shared code, `supabase/schema.sql` database
- `.github/workflows/jobs.yml` background jobs, `tests/` (`node --test tests/*.test.js`)

Go-live checklist (plain steps): [docs/GO-LIVE.md](docs/GO-LIVE.md). Every setting explained: [docs/SETUP.md](docs/SETUP.md). What changed: [CHANGELOG.md](CHANGELOG.md).
