begin;
create or replace function public.radar_admin_dashboard_v5()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  result:=public.radar_admin_dashboard_v4();
  return result || pg_catalog.jsonb_build_object('reports',coalesce((
    select pg_catalog.jsonb_agg(report || pg_catalog.jsonb_build_object(
      'upload_issues',(select count(*) from public.radar_upload_tickets t where t.context='report' and t.target_id=(report->>'id')::uuid and (t.verified_at is null or t.rejection_reason is not null)),
      'verified_uploads',(select count(*) from public.radar_upload_tickets t where t.context='report' and t.target_id=(report->>'id')::uuid and t.verified_at is not null and t.rejection_reason is null)
    )) from pg_catalog.jsonb_array_elements(result->'reports') report
  ),'[]'::jsonb));
end; $$;
revoke all on function public.radar_admin_dashboard_v5() from public,anon;
grant execute on function public.radar_admin_dashboard_v5() to authenticated;
commit;
