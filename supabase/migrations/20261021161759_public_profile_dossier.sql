begin;
-- A dossier starts from a published report. Unlinked handles are matched exactly,
-- while linked accounts are grouped only by their confirmed permanent identity.
create or replace function public.radar_profile_dossier(p_report_id uuid,p_limit integer default 20,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
with anchor as (
 select id,profile_id,handle from public.radar_reports where id=p_report_id and status='published'
), related as (
 select r.* from public.radar_reports r cross join anchor a where r.status='published' and
 ((a.profile_id is not null and r.profile_id=a.profile_id) or
 (a.profile_id is null and r.profile_id is null and pg_catalog.lower(r.handle)=pg_catalog.lower(a.handle)))
), page as (
 select id,created_at from related order by created_at desc,id
 limit least(greatest(coalesce(p_limit,20),1),50) offset greatest(coalesce(p_offset,0),0)
)
select pg_catalog.jsonb_build_object(
 'profile',public.radar_report_detail_v2(a.id)-'reason'-'proofs'-'category'-'event_date',
 'aliases',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('handle',x.handle,'first_seen_at',x.first_seen_at) order by x.first_seen_at,x.handle)
   from public.radar_profile_aliases x where x.profile_id=a.profile_id),'[]'::jsonb),
 'total_reports',(select count(*) from related),
 'streamer_count',(select count(distinct streamer_id) from related),
 'reports',coalesce((select pg_catalog.jsonb_agg(public.radar_report_detail_v2(p.id) order by p.created_at desc,p.id) from page p),'[]'::jsonb)
) from anchor a;
$$;
revoke all on function public.radar_profile_dossier(uuid,integer,integer) from public;
grant execute on function public.radar_profile_dossier(uuid,integer,integer) to anon,authenticated;
commit;
