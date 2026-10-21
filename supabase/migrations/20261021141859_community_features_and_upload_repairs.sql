begin;

-- Internal verifier needs these privileges; clients still have no direct ticket access.
grant select, update, delete on public.radar_upload_tickets to service_role;
revoke all on public.radar_upload_tickets from anon, authenticated;

alter table public.radar_streamers
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_at timestamptz;
create table if not exists public.radar_site_settings (
  singleton boolean primary key default true check(singleton),
  whatsapp_number text not null default '' check(whatsapp_number='' or whatsapp_number ~ '^[1-9][0-9]{9,14}$')
);
alter table public.radar_site_settings enable row level security;
revoke all on public.radar_site_settings from public, anon, authenticated;
insert into public.radar_site_settings(singleton,whatsapp_number) values(true,'5527981325470') on conflict(singleton) do nothing;

create or replace function public.radar_admin_set_verified(p_streamer_id uuid,p_verified boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_verified is null then raise exception 'Informe a verificação' using errcode='22023'; end if;
  update public.radar_streamers set is_verified=p_verified,verified_at=case when p_verified then now() else null end where id=p_streamer_id;
  if not found then raise exception 'Streamer não encontrado' using errcode='22023'; end if;
  insert into public.radar_audit(action,target_id,actor_id) values(case when p_verified then 'streamer_verified' else 'streamer_verification_removed' end,p_streamer_id,(select auth.uid()));
end; $$;
revoke all on function public.radar_admin_set_verified(uuid,boolean) from public,anon;
grant execute on function public.radar_admin_set_verified(uuid,boolean) to authenticated;

create or replace function public.radar_admin_set_whatsapp(p_number text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if p_number is null or p_number !~ '^[1-9][0-9]{9,14}$' then raise exception 'Informe o número com código do país e DDD' using errcode='22023'; end if;
  update public.radar_site_settings set whatsapp_number=p_number where singleton;
  insert into public.radar_audit(action,actor_id) values('whatsapp_updated',(select auth.uid()));
end; $$;
revoke all on function public.radar_admin_set_whatsapp(text) from public,anon;
grant execute on function public.radar_admin_set_whatsapp(text) to authenticated;

create or replace function public.radar_admin_dashboard_v4()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  return public.radar_admin_dashboard_v3() || pg_catalog.jsonb_build_object(
    'whatsapp_number',(select whatsapp_number from public.radar_site_settings where singleton),
    'streamers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id,'name',s.display_name,'active',s.is_active,'verified',s.is_verified,'verified_at',s.verified_at,'created_at',s.created_at) order by s.created_at desc) from public.radar_streamers s),'[]'::jsonb));
end; $$;
revoke all on function public.radar_admin_dashboard_v4() from public,anon;
grant execute on function public.radar_admin_dashboard_v4() to authenticated;

create or replace function public.radar_public_stats()
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'published_reports',(select count(*) from public.radar_reports where status='published'),
    'reported_profiles',(select count(distinct case when profile_id is not null then 'id:'||profile_id::text else 'handle:'||pg_catalog.lower(handle) end) from public.radar_reports where status='published'),
    'active_streamers',(select count(*) from public.radar_streamers where is_active),
    'verified_streamers',(select count(*) from public.radar_streamers where is_active and is_verified),
    'whatsapp_number',(select whatsapp_number from public.radar_site_settings where singleton)
  );
$$;
revoke all on function public.radar_public_stats() from public;
grant execute on function public.radar_public_stats() to anon,authenticated;

create or replace function public.radar_public_groups(p_query text default '',p_limit integer default 24,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
with published as (
  select r.id,r.profile_id,r.handle as original_handle,coalesce(p.current_handle,r.handle) as handle,
    case when r.profile_id is not null then 'id:'||r.profile_id::text else 'handle:'||pg_catalog.lower(r.handle) end as group_key,
    r.reason,r.category,r.event_date,r.created_at,coalesce(r.reviewed_at,r.created_at) as latest_at,
    p.avatar_path,p.last_checked_at,(p.id is not null) as profile_verified,
    r.streamer_id,s.display_name as streamer_name,(s.is_verified and s.is_active) as streamer_verified,
    coalesce((select pg_catalog.jsonb_agg(a.handle order by a.first_seen_at) from public.radar_profile_aliases a where a.profile_id=p.id and pg_catalog.lower(a.handle)<>pg_catalog.lower(p.current_handle)),'[]'::jsonb) as old_handles
  from public.radar_reports r join public.radar_streamers s on s.id=r.streamer_id
  left join public.radar_profiles p on p.id=r.profile_id where r.status='published'
), matching as (
  select distinct x.group_key from published x where coalesce(pg_catalog.btrim(p_query),'')=''
    or (pg_catalog.char_length(public.radar_fold_handle(p_query)) between 2 and 40 and (
      pg_catalog.strpos(public.radar_fold_handle(x.handle),public.radar_fold_handle(p_query))>0 or
      pg_catalog.strpos(public.radar_fold_handle(x.original_handle),public.radar_fold_handle(p_query))>0 or
      exists(select 1 from public.radar_profile_aliases a where a.profile_id=x.profile_id and pg_catalog.strpos(a.handle_key,public.radar_fold_handle(p_query))>0)))
), keys as (
  select x.group_key,max(x.latest_at) as latest_at from published x join matching m using(group_key)
  group by x.group_key order by max(x.latest_at) desc,x.group_key
  limit least(greatest(coalesce(p_limit,24),1),50) offset least(greatest(coalesce(p_offset,0),0),10000)
), result as (
  select k.latest_at,k.group_key,(select pg_catalog.to_jsonb(first_row)-'group_key'-'original_handle'-'streamer_id' from
    (select * from published x where x.group_key=k.group_key order by x.latest_at desc,x.id limit 1) first_row)
    || pg_catalog.jsonb_build_object(
      'report_count',(select count(*) from published x where x.group_key=k.group_key),
      'streamer_count',(select count(distinct streamer_id) from published x where x.group_key=k.group_key),
      'reports',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(child)-'group_key'-'original_handle'-'streamer_id' order by child.latest_at desc,child.id) from
        (select * from published x where x.group_key=k.group_key order by x.latest_at desc,x.id limit 50)child),'[]'::jsonb)) as data
  from keys k
)
select pg_catalog.jsonb_build_object('groups',coalesce((select pg_catalog.jsonb_agg(data order by latest_at desc,group_key) from result),'[]'::jsonb),
  'total_profiles',(select count(*) from matching));
$$;
revoke all on function public.radar_public_groups(text,integer,integer) from public;
grant execute on function public.radar_public_groups(text,integer,integer) to anon,authenticated;

-- New detail endpoint adds the author badge; the older endpoint remains compatible.
create or replace function public.radar_report_detail_v2(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
select public.radar_report_detail(r.id) || pg_catalog.jsonb_build_object('streamer_name',s.display_name,'streamer_verified',s.is_verified and s.is_active)
from public.radar_reports r join public.radar_streamers s on s.id=r.streamer_id where r.id=p_id and r.status='published';
$$;
revoke all on function public.radar_report_detail_v2(uuid) from public;
grant execute on function public.radar_report_detail_v2(uuid) to anon,authenticated;

-- Avoid racing the three-attachment limit. Lock the parent before counting tickets.
create or replace function public.radar_create_upload_ticket(p_context text,p_target_id uuid,p_secret text,p_mime text)
returns text language plpgsql security definer set search_path='' as $$
declare v_ext text; v_ticket uuid := extensions.gen_random_uuid(); v_path text; v_parent uuid;
begin
  v_ext:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' else null end;
  if v_ext is null then raise exception 'Tipo de arquivo não permitido' using errcode='22023'; end if;
  if p_context='report' then
    select id into v_parent from public.radar_reports where id=p_target_id and status='pending' and streamer_id=public.radar_streamer_for_pin(p_secret) for update;
  elsif p_context='appeal' and p_secret ~ '^[0-9A-Fa-f]{32}$' then
    select id into v_parent from public.radar_appeals where id=p_target_id and status='pending' and protocol_hash=pg_catalog.encode(extensions.digest(pg_catalog.upper(p_secret),'sha256'),'hex') for update;
  end if;
  if v_parent is null then raise exception 'Envio não autorizado ou prazo encerrado' using errcode='42501'; end if;
  if (select count(*) from public.radar_upload_tickets where context=p_context and target_id=p_target_id)>=3 then raise exception 'Máximo de três arquivos por envio' using errcode='22023'; end if;
  v_path:=case p_context when 'report' then 'reports/' else 'appeals/' end||p_target_id::text||'/'||v_ticket::text||'.'||v_ext;
  insert into public.radar_upload_tickets(id,context,target_id,object_path) values(v_ticket,p_context,p_target_id,v_path);
  return v_path;
end; $$;
revoke all on function public.radar_create_upload_ticket(text,uuid,text,text) from public;
grant execute on function public.radar_create_upload_ticket(text,uuid,text,text) to anon,authenticated;

create or replace function public.radar_admin_approve_public_evidence(p_report_id uuid,p_source_path text,p_public_path text,p_mime text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.radar_reports where id=p_report_id and status='published') then raise exception 'Relato indisponível'; end if;
  if p_source_path is null or p_public_path is null or p_mime is null
    or p_source_path !~ ('^reports/'||p_report_id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$')
    or p_public_path !~ ('^reports/'||p_report_id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$')
    or p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Arquivo inválido'; end if;
  if not exists(select 1 from public.radar_upload_tickets where object_path=p_source_path and verified_at is not null and detected_mime in ('image/jpeg','image/png','image/webp')) then raise exception 'A prova original ainda não foi verificada'; end if;
  if not exists(select 1 from storage.objects where bucket_id='radar-evidence' and name=p_source_path)
    or not exists(select 1 from storage.objects where bucket_id='radar-public-evidence' and name=p_public_path and metadata->>'mimetype'=p_mime) then raise exception 'Arquivo não encontrado ou formato incompatível'; end if;
  insert into public.radar_public_evidence(report_id,source_path,public_path,mime,approved_by)
    values(p_report_id,p_source_path,p_public_path,p_mime,(select auth.uid())) returning id into v_id;
  insert into public.radar_audit(action,target_id,actor_id) values('evidence_published',p_report_id,(select auth.uid()));
  return v_id;
end; $$;
revoke all on function public.radar_admin_approve_public_evidence(uuid,text,text,text) from public,anon;
grant execute on function public.radar_admin_approve_public_evidence(uuid,text,text,text) to authenticated;

-- Keep the established function contract and validation, tightening only the handle alphabet.
do $patch$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.radar_submit_report_v2(text,text,text,text,date)'::regprocedure);
  if pg_catalog.strpos(definition,'^[[:alnum:]_.-]{2,40}$')>0 then
    execute pg_catalog.replace(definition,'^[[:alnum:]_.-]{2,40}$','^[A-Za-z0-9._]{2,40}$');
  end if;
end;
$patch$;

-- Reject malformed handles at submission instead of recording identities the lookup cannot read.
-- Compatibility functions still call this internal PIN resolver; do not expose it.
revoke all on function public.rls_auto_enable() from public,anon,authenticated;
create index if not exists radar_reports_published_profile_idx on public.radar_reports(profile_id,reviewed_at desc) where status='published';
create index if not exists radar_reports_published_handle_idx on public.radar_reports(pg_catalog.lower(handle)) where status='published' and profile_id is null;
commit;
