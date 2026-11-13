-- Speed: indexes for the lookups the CRM does on every screen. Nothing here
-- changes or moves data; an index is only a faster way to find rows.

-- "Next action" on every prospect row, and the overdue / stale filters. The
-- only index on a task's prospect covered open follow-ups, so every other
-- lookup read the whole tasks table once per prospect on the page.
create index if not exists crm_tasks_contact_idx on crm_tasks (contact_id, status, due_at);
-- Team task lists: open tasks, soonest first.
create index if not exists crm_tasks_open_due_idx on crm_tasks (due_at) where status = 'open';

-- The prospect list opens "most recently updated first".
create index if not exists crm_contacts_updated_idx on crm_contacts (updated_at desc);
create index if not exists crm_contacts_owner_updated_idx on crm_contacts (owner_id, updated_at desc);
-- The unassigned pool on the Pipeline, newest first.
create index if not exists crm_contacts_pool_idx on crm_contacts (created_at desc) where owner_id is null and stage = 'prospect';

-- All Calls and the dashboards read calls by time, across the whole team.
create index if not exists crm_calls_started_idx on crm_calls (started_at desc);
-- Calls waiting for a manager's review.
create index if not exists crm_calls_review_idx on crm_calls (started_at desc) where analysis_status = 'needs_review';
-- A call's insights (objections, pain points) on the call page.
create index if not exists crm_call_insights_call_idx on crm_call_insights (call_id);

-- Everything listed on a prospect's page, and the meeting shown on its card.
create index if not exists crm_meetings_contact_idx on crm_meetings (contact_id, scheduled_at);
create index if not exists crm_handoffs_contact_idx on crm_handoffs (contact_id, created_at desc);
create index if not exists crm_assignments_contact_idx on crm_assignments (contact_id, created_at desc);

-- Daily reports by day.
create index if not exists crm_daily_reports_date_idx on crm_daily_reports (report_date desc);

-- A Legion member's own board ("mine") looks prospects up by their Legion owner.
create index if not exists crm_contacts_legion_owner_idx on crm_contacts (legion_owner_id) where legion_owner_id is not null;
