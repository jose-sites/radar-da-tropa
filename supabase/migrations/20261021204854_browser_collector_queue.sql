-- Private browser queue metadata; existing RLS/grants are unchanged.
alter table public.radar_reports
  add column browser_attempt_at timestamptz,
  add column browser_next_at timestamptz,
  add column browser_error text,
  add column browser_lease uuid,
  add column browser_attempts integer not null default 0 check (browser_attempts >= 0);
create index radar_reports_browser_queue on public.radar_reports (browser_next_at)
  where profile_id is null and status = 'published';
