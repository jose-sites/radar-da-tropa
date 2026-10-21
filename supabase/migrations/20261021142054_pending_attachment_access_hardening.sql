begin;
create or replace function public.radar_check_upload_secret(p_path text,p_secret text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_ticket public.radar_upload_tickets%rowtype;
begin
  select * into v_ticket from public.radar_upload_tickets where object_path=p_path;
  if not found or v_ticket.expires_at<now() then return false; end if;
  if v_ticket.context='report' then
    return exists(select 1 from public.radar_reports r where r.id=v_ticket.target_id and r.status='pending'
      and r.streamer_id=public.radar_streamer_for_pin(p_secret));
  end if;
  if v_ticket.context='appeal' and p_secret ~ '^[0-9A-Fa-f]{32}$' then
    return exists(select 1 from public.radar_appeals a where a.id=v_ticket.target_id and a.status='pending'
      and a.protocol_hash=pg_catalog.encode(extensions.digest(pg_catalog.upper(p_secret),'sha256'),'hex'));
  end if;
  return false;
end; $$;
revoke all on function public.radar_check_upload_secret(text,text) from public,anon,authenticated;
grant execute on function public.radar_check_upload_secret(text,text) to service_role;
commit;
