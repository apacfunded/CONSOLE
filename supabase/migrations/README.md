# Upgrading an existing database

`schema.sql` is for a **new** Supabase project. `create table if not exists` does nothing to a table that already
exists, so a database made from an older version of Console won't get new columns from it.

If you already ran an older `schema.sql`, open Supabase → SQL Editor and run the migration files in this folder,
oldest first. Each one is safe to run twice.

| File | What it adds |
|---|---|
| `2026-10-06-dev-share-and-burns.sql` | dev-chosen AI share (`ai_pct`), dev payouts (`dev_lamports`), claim paging (`claimed_at`), the `burns` table, and the removal of the old reserve kind |
| `2026-10-07-ai-tasks.sql` | AI work tasks: the `tasks` table and the per-coin fee and task counters |
