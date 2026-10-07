-- Run once in Supabase > SQL Editor on a database made before AI tasks. Safe to run again.
alter table coins add column if not exists fees_lamports bigint not null default 0;
alter table coins add column if not exists fees_waiting_lamports bigint not null default 0;
alter table coins add column if not exists tasks_unlocked int not null default 0;
alter table coins add column if not exists tasks_done int not null default 0;

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
alter table tasks enable row level security;
revoke all on tasks from anon, authenticated;
