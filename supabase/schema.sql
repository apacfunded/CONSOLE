-- Console database. Paste into Supabase > SQL Editor and run once.
-- Every table has row-level security ON and NO policies, and public roles get no grants,
-- so only the server (service-role key, stored in Vercel env) can read or write.

create table if not exists coins (
  mint text primary key,
  target text not null,               -- the game or combo id from games.json this coin funds
  ticker text not null, name text not null, img text, description text, twitter text,
  creator text not null,              -- wallet that launched it (signed + paid); receives the dev share
  ai_pct int not null check (ai_pct between 25 and 100), -- dev's pick at launch: share of fees (after the 10% buyback) for AI work. Never changes.
  pool_wallet text not null unique,   -- per-coin wallet set as pump.fun creator; receives its creator fees
  launch_sig text, confirmed boolean not null default false,
  mc numeric not null default 0,
  pool_lamports bigint not null default 0,      -- refreshed by the claim job (claimed + still in pump.fun's vault)
  funded_lamports bigint not null default 0,    -- total sent to the compute wallet for this coin's games
  dev_lamports bigint not null default 0,       -- total paid to the dev
  round_no int not null default 0,
  claimed_at timestamptz,                       -- last time the claim job looked at this coin (oldest first next run)
  fees_lamports bigint not null default 0,      -- creator fees claimed so far (volume is estimated from this)
  fees_waiting_lamports bigint not null default 0, -- fees still waiting in pump.fun's vaults at the last claim run
  tasks_unlocked int not null default 0,        -- AI tasks earned so far: one per TASK_EVERY_SOL of estimated volume
  tasks_done int not null default 0,
  created_at timestamptz not null default now()
);
-- Backstop for "one coin per game or combo": only one confirmed coin per target, ever.
create unique index if not exists coins_one_live_per_target on coins (target) where confirmed;
create index if not exists coins_creator on coins (creator);

create table if not exists mc_history (
  mint text references coins(mint) on delete cascade, t timestamptz not null, mc numeric not null,
  primary key (mint, t)
);

-- One row per split attempt. The unique (mint, round_no) makes a round impossible to send twice.
create table if not exists payout_rounds (
  id bigserial primary key, mint text not null references coins(mint), round_no int not null,
  pool_lamports bigint not null, plan jsonb not null,
  status text not null default 'sending' check (status in ('sending','done','failed')),
  created_at timestamptz not null default now(), finished_at timestamptz,
  unique (mint, round_no)
);

create table if not exists payouts (
  id bigserial primary key, round_id bigint references payout_rounds(id), mint text not null, target text not null,
  wallet text not null, lamports bigint not null,
  kind text not null check (kind in ('compute','buyback','dev')),
  tx text, status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now(),
  unique (round_id, kind)
);

create table if not exists activity (
  id bigserial primary key, kind text not null check (kind in ('launch','claim','compute','buyback','dev','burn')),
  mint text, target text, wallet text, lamports bigint, tx text, at timestamptz not null default now()
);

-- $CONSOLE buybacks and burns are done by hand from the buyback wallet, then recorded here (api/admin/burn).
create table if not exists burns (
  id bigserial primary key, tx text not null unique, sol_lamports bigint not null default 0, tokens numeric not null default 0,
  note text, at timestamptz not null default now()
);

-- AI work. One row per task a coin has earned; (mint, n) is unique so a task is never created twice.
create table if not exists tasks (
  id bigserial primary key, mint text not null references coins(mint) on delete cascade, n int not null,
  title text not null, brief text not null default '', vol_sol numeric not null default 0,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  source text check (source in ('ai','team')), model text,
  summary text, detail text, attempts int not null default 0,
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
  unique (mint, n)
);
create index if not exists tasks_queue on tasks (status, created_at);

create table if not exists rate_limits (key text primary key, n int not null, reset_at timestamptz not null);

-- Lock everything down.
do $$ declare t text; begin
  foreach t in array array['coins','mc_history','payout_rounds','payouts','activity','burns','tasks','rate_limits'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- Atomic rate limiter: returns true if this hit is allowed.
create or replace function hit_rate_limit(p_key text, p_max int, p_window int) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  insert into rate_limits(key, n, reset_at) values (p_key, 1, now() + make_interval(secs => p_window))
  on conflict (key) do update set
    n = case when rate_limits.reset_at < now() then 1 else rate_limits.n + 1 end,
    reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => p_window) else rate_limits.reset_at end
  returning n into cur;
  return cur <= p_max;
end $$;
revoke all on function hit_rate_limit(text, int, int) from public, anon, authenticated;

-- Reserves a game or combo for one launch. Returns false if it already has a live coin, or someone
-- started a launch for it in the last 3 minutes (a Solana launch can't land after its blockhash expires,
-- so an abandoned launch frees the slot again). The advisory lock makes two launches at once impossible.
drop function if exists insert_coin_if_free(text, text, text, text, text, text, text, text, text);
create or replace function insert_coin_if_free(p_mint text, p_target text, p_ticker text, p_name text, p_img text,
  p_description text, p_twitter text, p_creator text, p_pool_wallet text, p_ai_pct int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('console-target:' || p_target));
  if exists (select 1 from coins where target = p_target and (confirmed or created_at > now() - interval '3 minutes')) then
    return false;
  end if;
  if exists (select 1 from coins where creator = p_creator and not confirmed and created_at > now() - interval '3 minutes') then
    return false;
  end if;
  insert into coins (mint, target, ticker, name, img, description, twitter, creator, pool_wallet, ai_pct)
  values (p_mint, p_target, p_ticker, p_name, p_img, p_description, p_twitter, p_creator, p_pool_wallet, p_ai_pct);
  return true;
end $$;
revoke all on function insert_coin_if_free(text, text, text, text, text, text, text, text, text, int) from public, anon, authenticated;

-- Housekeeping.
create or replace function cleanup() returns void language sql security definer set search_path = public as $$
  delete from rate_limits where reset_at < now() - interval '1 hour';
  delete from mc_history where t < now() - interval '14 days';
$$;
revoke all on function cleanup() from public, anon, authenticated;
