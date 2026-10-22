-- Adds a third Legion meeting stage. Only widens the allowed values;
-- no existing row is read, moved or changed.

alter table crm_contacts drop constraint if exists crm_contacts_stage_check;
alter table crm_contacts add constraint crm_contacts_stage_check
  check (stage in ('prospect', 'qualified', 'legion_meet_1', 'legion_meet_2', 'legion_meet_3'));

alter table crm_meetings drop constraint if exists crm_meetings_stage_check;
alter table crm_meetings add constraint crm_meetings_stage_check
  check (stage in ('legion_meet_1', 'legion_meet_2', 'legion_meet_3'));
