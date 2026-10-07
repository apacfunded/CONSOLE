-- Run once in Supabase > SQL Editor on a database made from an older schema.sql. Safe to run again.
alter table coins add column if not exists ai_pct int not null default 100;
alter table coins drop constraint if exists coins_ai_pct_check;
alter table coins add constraint coins_ai_pct_check check (ai_pct between 25 and 100);
alter table coins add column if not exists dev_lamports bigint not null default 0;
alter table coins add column if not exists claimed_at timestamptz;

-- the old 'reserve' kind is gone; 'dev' and 'burn' are new
alter table payouts drop constraint if exists payouts_kind_check;
alter table payouts add constraint payouts_kind_check check (kind in ('compute','buyback','dev','reserve'));
alter table activity drop constraint if exists activity_kind_check;
alter table activity add constraint activity_kind_check check (kind in ('launch','claim','compute','buyback','dev','burn','reserve'));

create table if not exists burns (
  id bigserial primary key, tx text not null unique, sol_lamports bigint not null default 0, tokens numeric not null default 0,
  note text, at timestamptz not null default now()
);
alter table burns enable row level security;
revoke all on burns from anon, authenticated;

-- the launch function gained an ai_pct argument
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
