-- Onboarding guide for the sales team and Legion: it shows on each of a
-- person's first 12 sign-ins until they finish it with "never show again".
-- Only adds columns; existing rows keep everything they had.

alter table crm_users add column if not exists login_count integer not null default 0;
-- The sign-in (login_count value) at which the guide was last watched to the end.
alter table crm_users add column if not exists guide_seen_at_login integer not null default 0;
alter table crm_users add column if not exists guide_never boolean not null default false;

-- People who are already signed in count as on their first sign-in, so they
-- see the guide now rather than only after they next sign in.
update crm_users set login_count = 1 where login_count = 0 and last_login_at is not null;
