-- Live events (notifications, dial requests, call progress) are written here
-- and polled by open screens. This works the same on a single server and on
-- serverless hosting (Vercel), where no process can hold a connection open.

create table if not exists crm_events (
  id          bigserial primary key,
  -- null = for everyone signed in (the team feed)
  user_id     uuid references crm_users (id) on delete cascade,
  type        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists crm_events_user_idx on crm_events (user_id, id);
create index if not exists crm_events_created_idx on crm_events (created_at);

alter table crm_events enable row level security;
