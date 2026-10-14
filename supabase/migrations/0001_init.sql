-- Focus Realm Sales CRM — initial schema.
--
-- Every table is prefixed crm_ so the CRM can share a Supabase project with
-- the HR console without colliding. Row level security is ON with no
-- policies on every table: the anon/publishable key can reach nothing. The
-- CRM backend connects with the database connection string (or the service
-- role), which bypasses RLS, and applies every permission rule itself.

-- ---------------------------------------------------------------- people

create table if not exists crm_users (
  id                    uuid primary key default gen_random_uuid(),
  -- The login ID, e.g. FR-0042. The HR console's Workspace employee ID when
  -- the person came from HR, so everyone signs in everywhere with one ID.
  employee_code         text not null unique,
  email                 text,
  full_name             text not null,
  phone                 text,
  role                  text not null check (role in ('founder', 'sales_head', 'sales_rep', 'legion')),
  title                 text,
  department            text,
  status                text not null default 'active' check (status in ('active', 'inactive', 'offboarded')),
  password_hash         text,
  must_change_password  boolean not null default true,
  -- Bumped to sign the person out of every device at once.
  token_version         integer not null default 0,
  -- The HR console's candidate id. Set only for people HR provisioned.
  hr_external_id        text unique,
  source                text not null default 'manual' check (source in ('manual', 'hr', 'seed')),
  avatar_hue            integer not null default 214,
  max_active_prospects  integer not null default 60,
  daily_call_target     integer not null default 40,
  start_date            date,
  last_login_at         timestamptz,
  last_active_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ------------------------------------------------------------ the database

create table if not exists crm_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Lower-cased, punctuation-free name used to match companies on import.
  name_key    text not null unique,
  industry    text,
  city        text,
  website     text,
  size_band   text,
  created_at  timestamptz not null default now()
);

create table if not exists crm_import_batches (
  id               uuid primary key default gen_random_uuid(),
  file_name        text,
  uploaded_by      uuid references crm_users (id) on delete set null,
  campaign         text,
  segment          text,
  source           text,
  total_rows       integer not null default 0,
  created_count    integer not null default 0,
  duplicate_count  integer not null default 0,
  invalid_count    integer not null default 0,
  report           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create table if not exists crm_contacts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references crm_companies (id) on delete set null,
  full_name          text not null,
  designation        text,
  phone              text,
  -- Digits only, with the country code (e.g. 919876543210). Unique, so the
  -- same number can never be imported twice.
  phone_key          text,
  alt_phone          text,
  email              text,
  email_key          text,
  city               text,
  source             text,
  campaign           text,
  segment            text,
  tags               text[] not null default '{}',
  -- The broad milestone shown on the main Kanban board.
  stage              text not null default 'prospect'
                     check (stage in ('prospect', 'qualified', 'legion_meet_1', 'legion_meet_2')),
  -- The operational status between milestones (proposal §5.2).
  status             text not null default 'new'
                     check (status in ('new', 'outreach', 'follow_up', 'qualification_review', 'qualified',
                                       'handoff_pending', 'handed_off', 'returned', 'closed_won', 'closed_lost',
                                       'disqualified')),
  owner_id           uuid references crm_users (id) on delete set null,
  legion_owner_id    uuid references crm_users (id) on delete set null,
  do_not_contact     boolean not null default false,
  is_invalid         boolean not null default false,
  qualification      jsonb not null default '{}'::jsonb,
  -- Lead temperature 0–100, refreshed by call analysis.
  temperature        integer,
  last_call_outcome  text,
  last_contacted_at  timestamptz,
  next_action_at     timestamptz,
  call_count         integer not null default 0,
  import_batch_id    uuid references crm_import_batches (id) on delete set null,
  notes              text,
  created_by         uuid references crm_users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists crm_contacts_phone_key_uq on crm_contacts (phone_key) where phone_key is not null;
create index if not exists crm_contacts_owner_idx on crm_contacts (owner_id);
create index if not exists crm_contacts_stage_idx on crm_contacts (stage);
create index if not exists crm_contacts_status_idx on crm_contacts (status);
create index if not exists crm_contacts_campaign_idx on crm_contacts (campaign);
create index if not exists crm_contacts_email_key_idx on crm_contacts (email_key);

-- ------------------------------------------------------------- allocation

create table if not exists crm_allocation_batches (
  id                uuid primary key default gen_random_uuid(),
  initiated_by      uuid references crm_users (id) on delete set null,
  settings          jsonb not null,
  settings_version  integer not null default 1,
  assigned_count    integer not null default 0,
  summary           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create table if not exists crm_assignments (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         uuid not null references crm_contacts (id) on delete cascade,
  user_id            uuid not null references crm_users (id) on delete cascade,
  batch_id           uuid references crm_allocation_batches (id) on delete set null,
  assigned_by        uuid references crm_users (id) on delete set null,
  previous_owner_id  uuid references crm_users (id) on delete set null,
  kind               text not null default 'allocation'
                     check (kind in ('allocation', 'manual', 'reassignment', 'import')),
  reason             text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  ended_at           timestamptz
);

-- One active owner per prospect, enforced by the database (proposal §4.2.6).
create unique index if not exists crm_assignments_one_active on crm_assignments (contact_id) where active;
create index if not exists crm_assignments_user_idx on crm_assignments (user_id) where active;

-- ------------------------------------------------------------------ calls

create sequence if not exists crm_call_seq;

create table if not exists crm_calls (
  id                   uuid primary key default gen_random_uuid(),
  -- Human-readable unique call ID, e.g. FRC-261014-00042.
  call_code            text not null unique,
  contact_id           uuid not null references crm_contacts (id) on delete cascade,
  user_id              uuid not null references crm_users (id) on delete cascade,
  mode                 text not null check (mode in ('bridge', 'phone_link', 'manual', 'demo')),
  provider             text,
  provider_ref         text,
  phone_dialed         text,
  status               text not null default 'initiated'
                       check (status in ('initiated', 'ringing', 'in_progress', 'completed', 'failed', 'no_answer',
                                         'busy', 'cancelled')),
  outcome              text,
  notes                text,
  started_at           timestamptz not null default now(),
  answered_at          timestamptz,
  ended_at             timestamptz,
  duration_sec         integer,
  recording_status     text not null default 'none'
                       check (recording_status in ('none', 'awaiting', 'uploaded', 'failed', 'unavailable')),
  recording_path       text,
  recording_mime       text,
  recording_bytes      integer,
  recording_source_url text,
  consent_notice       boolean not null default false,
  transcript           jsonb,
  transcript_status    text not null default 'none'
                       check (transcript_status in ('none', 'queued', 'processing', 'done', 'failed', 'skipped')),
  analysis             jsonb,
  analysis_status      text not null default 'none'
                       check (analysis_status in ('none', 'queued', 'processing', 'done', 'failed', 'needs_review')),
  analysis_model       text,
  score                integer,
  analyzed_at          timestamptz,
  review               jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists crm_calls_user_started_idx on crm_calls (user_id, started_at desc);
create index if not exists crm_calls_contact_idx on crm_calls (contact_id, started_at desc);
create index if not exists crm_calls_provider_ref_idx on crm_calls (provider_ref);

-- Objections, pain points, product requests… pulled out of every analysed
-- call so trends can be aggregated across the team.
create table if not exists crm_call_insights (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null references crm_calls (id) on delete cascade,
  user_id     uuid references crm_users (id) on delete set null,
  contact_id  uuid references crm_contacts (id) on delete set null,
  kind        text not null check (kind in ('objection', 'pain_point', 'product_request', 'buying_signal',
                                            'competitor', 'risk')),
  category    text,
  text        text not null,
  evidence    text,
  handled     text check (handled in ('well', 'partially', 'poorly')),
  confidence  real,
  created_at  timestamptz not null default now()
);

create index if not exists crm_call_insights_kind_idx on crm_call_insights (kind, created_at desc);

-- ------------------------------------------------------- tasks & handoffs

create table if not exists crm_tasks (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references crm_contacts (id) on delete cascade,
  assigned_to   uuid not null references crm_users (id) on delete cascade,
  created_by    uuid references crm_users (id) on delete set null,
  kind          text not null default 'follow_up'
                check (kind in ('call', 'follow_up', 'meeting', 'email', 'whatsapp', 'review', 'custom')),
  title         text not null,
  reason        text,
  due_at        timestamptz,
  reminder_at   timestamptz,
  reminded_at   timestamptz,
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status        text not null default 'open' check (status in ('open', 'done', 'missed', 'cancelled')),
  completed_at  timestamptz,
  escalated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- At most one open follow-up per prospect: scheduling a new one reschedules.
create unique index if not exists crm_tasks_one_open_followup
  on crm_tasks (contact_id) where status = 'open' and kind = 'follow_up' and contact_id is not null;
create index if not exists crm_tasks_assignee_idx on crm_tasks (assigned_to, status, due_at);

create table if not exists crm_handoffs (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references crm_contacts (id) on delete cascade,
  from_user_id   uuid references crm_users (id) on delete set null,
  to_user_id     uuid references crm_users (id) on delete set null,
  team           text not null default 'legion',
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'returned', 'cancelled')),
  note           text,
  checklist      jsonb not null default '{}'::jsonb,
  return_reason  text,
  decided_by     uuid references crm_users (id) on delete set null,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

create unique index if not exists crm_handoffs_one_pending on crm_handoffs (contact_id) where status = 'pending';

create table if not exists crm_meetings (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references crm_contacts (id) on delete cascade,
  stage           text not null check (stage in ('legion_meet_1', 'legion_meet_2')),
  scheduled_at    timestamptz not null,
  duration_min    integer not null default 45,
  location        text,
  legion_user_id  uuid references crm_users (id) on delete set null,
  sales_user_id   uuid references crm_users (id) on delete set null,
  status          text not null default 'scheduled'
                  check (status in ('scheduled', 'completed', 'no_show', 'cancelled')),
  outcome         text,
  notes           text,
  created_by      uuid references crm_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists crm_meetings_when_idx on crm_meetings (scheduled_at);

-- Everything that happened to a prospect, newest first on the detail page.
create table if not exists crm_activities (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references crm_contacts (id) on delete cascade,
  user_id     uuid references crm_users (id) on delete set null,
  kind        text not null,
  title       text not null,
  body        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists crm_activities_contact_idx on crm_activities (contact_id, created_at desc);
create index if not exists crm_activities_recent_idx on crm_activities (created_at desc);

-- ---------------------------------------------------------- daily reports

create table if not exists crm_daily_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references crm_users (id) on delete cascade,
  report_date   date not null,
  status        text not null default 'pending'
                check (status in ('pending', 'generating', 'ready', 'emailed', 'failed', 'no_activity')),
  metrics       jsonb not null default '{}'::jsonb,
  report        jsonb,
  model         text,
  emailed_to    text[] not null default '{}',
  emailed_at    timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, report_date)
);

-- Who receives the daily reports, besides every sales head (who always does
-- unless that is switched off in settings). Managed by the founders.
create table if not exists crm_report_recipients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  label       text not null default 'Other',
  active      boolean not null default true,
  added_by    uuid references crm_users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists crm_report_recipients_email_uq on crm_report_recipients (lower(email));

-- ------------------------------------------------------- platform plumbing

create table if not exists crm_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references crm_users (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists crm_notifications_user_idx on crm_notifications (user_id, created_at desc);

create table if not exists crm_audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references crm_users (id) on delete set null,
  actor_label  text,
  action       text not null,
  entity       text,
  entity_id    text,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists crm_audit_log_created_idx on crm_audit_log (created_at desc);

-- A small durable job queue: transcription, analysis, reports and email are
-- retried with backoff and survive restarts.
create table if not exists crm_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  run_at        timestamptz not null default now(),
  locked_at     timestamptz,
  last_error    text,
  dedupe_key    text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create unique index if not exists crm_jobs_dedupe_uq on crm_jobs (dedupe_key) where dedupe_key is not null and status in ('queued', 'running');
create index if not exists crm_jobs_due_idx on crm_jobs (status, run_at);

create table if not exists crm_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references crm_users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Every HR console event, applied once. A retried event returns the stored
-- result instead of creating a second account.
create table if not exists crm_hr_events (
  event_id     text primary key,
  type         text not null,
  external_id  text,
  result       jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- RLS

alter table crm_users enable row level security;
alter table crm_companies enable row level security;
alter table crm_import_batches enable row level security;
alter table crm_contacts enable row level security;
alter table crm_allocation_batches enable row level security;
alter table crm_assignments enable row level security;
alter table crm_calls enable row level security;
alter table crm_call_insights enable row level security;
alter table crm_tasks enable row level security;
alter table crm_handoffs enable row level security;
alter table crm_meetings enable row level security;
alter table crm_activities enable row level security;
alter table crm_daily_reports enable row level security;
alter table crm_report_recipients enable row level security;
alter table crm_notifications enable row level security;
alter table crm_audit_log enable row level security;
alter table crm_jobs enable row level security;
alter table crm_settings enable row level security;
alter table crm_hr_events enable row level security;
