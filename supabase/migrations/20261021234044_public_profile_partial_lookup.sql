begin;
alter table public.radar_reports
 add column public_profile_name text check (char_length(public_profile_name) between 1 and 100),
 add column public_profile_checked_at timestamptz;
-- Preserve grouping and all existing security boundaries, adding two public fields.
do $$
declare definition text;
begin
 definition:=pg_catalog.pg_get_functiondef('public.radar_public_groups(text,integer,integer)'::regprocedure);
 if pg_catalog.strpos(definition,'p.avatar_path,p.last_checked_at')=0 then raise exception 'Unexpected group API definition'; end if;
 definition:=pg_catalog.replace(definition,'p.avatar_path,p.last_checked_at','r.public_profile_name,r.public_profile_checked_at,p.avatar_path,p.last_checked_at');
 execute definition;
end; $$;
create or replace function public.radar_report_detail_v2(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
select public.radar_report_detail(r.id) || pg_catalog.jsonb_build_object(
 'streamer_name',s.display_name,'streamer_verified',s.is_verified and s.is_active,
 'public_profile_name',r.public_profile_name,'public_profile_checked_at',r.public_profile_checked_at)
from public.radar_reports r join public.radar_streamers s on s.id=r.streamer_id
where r.id=p_id and r.status='published';
$$;
revoke all on function public.radar_report_detail_v2(uuid) from public;
grant execute on function public.radar_report_detail_v2(uuid) to anon,authenticated;
-- Keep the existing job and credentials; extend the HTTP timeout to fit the batch.
select cron.alter_job(jobid, schedule := '*/15 * * * *', command := $command$
 select net.http_post(
  url := 'https://wcbixbwekbtqgreitodh.supabase.co/functions/v1/radar-sync',
  headers := jsonb_build_object('Content-Type','application/json','x-radar-sync-token',
   (select decrypted_secret from vault.decrypted_secrets where name='radar_sync_token')),
  body := '{}'::jsonb, timeout_milliseconds := 110000);
$command$) from cron.job where jobname='radar-profile-sync-every-3h';
commit;
