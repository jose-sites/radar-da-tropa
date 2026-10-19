-- Radar da Tropa: páginas de relato, provas revisadas e controles de segurança.
begin;

create table if not exists public.radar_pin_attempts (
  ip_hash text not null,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key(ip_hash,window_start)
);
alter table public.radar_pin_attempts enable row level security;
revoke all on public.radar_pin_attempts from anon,authenticated;
create or replace function public.radar_verify_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
declare v_name text;
declare v_headers jsonb;
declare v_ip text;
declare v_count integer;
begin
  begin v_headers := nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb;
  exception when others then v_headers := '{}'::jsonb; end;
  v_ip := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_headers->>'x-real-ip',v_headers->>'x-forwarded-for',''),'^(.*,)[[:space:]]*',''));
  if v_ip<>'' then
    insert into public.radar_pin_attempts(ip_hash,window_start,attempts)
    values(pg_catalog.encode(extensions.digest(v_ip,'sha256'),'hex'),
      pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch',now())/900)*900),1)
    on conflict(ip_hash,window_start) do update set attempts=public.radar_pin_attempts.attempts+1
    returning attempts into v_count;
    if v_count>25 then return null; end if;
  end if;
  v_id := public.radar_streamer_for_pin(p_pin);
  if v_id is null then return null; end if;
  select display_name into v_name from public.radar_streamers where id=v_id;
  return pg_catalog.jsonb_build_object('id',v_id,'name',v_name);
end; $$;

alter table public.radar_upload_tickets
  add column if not exists verified_at timestamptz,
  add column if not exists detected_mime text,
  add column if not exists duration_seconds numeric,
  add column if not exists rejection_reason text;

create or replace function public.radar_check_upload_secret(p_path text,p_secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ticket public.radar_upload_tickets%rowtype;
begin
  select * into v_ticket from public.radar_upload_tickets where object_path=p_path;
  if not found or v_ticket.expires_at<now() then return false; end if;
  if v_ticket.context='report' then
    return exists(select 1 from public.radar_reports r where r.id=v_ticket.target_id
      and r.streamer_id=public.radar_streamer_for_pin(p_secret));
  end if;
  if v_ticket.context='appeal' and p_secret ~ '^[0-9A-Fa-f]{32}$' then
    return exists(select 1 from public.radar_appeals a where a.id=v_ticket.target_id
      and a.protocol_hash=pg_catalog.encode(extensions.digest(pg_catalog.upper(p_secret),'sha256'),'hex'));
  end if;
  return false;
end; $$;

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4']
where id = 'radar-evidence';

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('radar-public-evidence','radar-public-evidence',true,20971520,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = true, file_size_limit = 20971520,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create table if not exists public.radar_public_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  report_id uuid not null references public.radar_reports(id) on delete cascade,
  source_path text not null unique,
  public_path text not null unique,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now()
);
create index if not exists radar_public_evidence_report_idx
  on public.radar_public_evidence(report_id, approved_at);
alter table public.radar_public_evidence enable row level security;
revoke all on public.radar_public_evidence from anon, authenticated;

drop policy if exists radar_public_evidence_admin_insert on storage.objects;
create policy radar_public_evidence_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id='radar-public-evidence' and public.radar_is_admin());
drop policy if exists radar_public_evidence_admin_delete on storage.objects;
create policy radar_public_evidence_admin_delete on storage.objects
for delete to authenticated
using (bucket_id='radar-public-evidence' and public.radar_is_admin());

create or replace function public.radar_recent_reports()
returns table(id uuid,handle text,avatar_path text)
language sql stable security definer set search_path = '' as $$
  select r.id, coalesce(p.current_handle,r.handle), p.avatar_path
  from public.radar_reports r
  left join public.radar_profiles p on p.id=r.profile_id
  where r.status='published'
  order by r.created_at desc limit 3;
$$;

create or replace function public.radar_report_detail(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id',r.id,'handle',coalesce(p.current_handle,r.handle),'reason',r.reason,
    'category',r.category,'event_date',r.event_date,'created_at',r.created_at,
    'avatar_path',p.avatar_path,'profile_verified',p.id is not null,
    'last_checked_at',p.last_checked_at,
    'old_handles',coalesce((select pg_catalog.jsonb_agg(a.handle order by a.first_seen_at)
      from public.radar_profile_aliases a where a.profile_id=p.id
        and pg_catalog.lower(a.handle)<>pg_catalog.lower(p.current_handle)),'[]'::jsonb),
    'proofs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',e.id,'path',e.public_path,'mime',e.mime) order by e.approved_at)
      from public.radar_public_evidence e where e.report_id=r.id),'[]'::jsonb)
  )
  from public.radar_reports r
  left join public.radar_profiles p on p.id=r.profile_id
  where r.id=p_id and r.status='published';
$$;

create or replace function public.radar_admin_approve_public_evidence(
  p_report_id uuid,p_source_path text,p_public_path text,p_mime text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  if not exists(select 1 from public.radar_reports where id=p_report_id and status='published') then
    raise exception 'Relato indisponível' using errcode='22023'; end if;
  if p_source_path !~ ('^reports/'||p_report_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Origem inválida' using errcode='22023'; end if;
  if p_public_path !~ ('^reports/'||p_report_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Caminho público inválido' using errcode='22023'; end if;
  if p_mime not in ('image/jpeg','image/png','image/webp') then
    raise exception 'Formato inválido' using errcode='22023'; end if;
  if not exists(select 1 from storage.objects where bucket_id='radar-evidence' and name=p_source_path)
    or not exists(select 1 from storage.objects where bucket_id='radar-public-evidence' and name=p_public_path) then
    raise exception 'Arquivo não encontrado' using errcode='22023'; end if;
  insert into public.radar_public_evidence(report_id,source_path,public_path,mime,approved_by)
  values(p_report_id,p_source_path,p_public_path,p_mime,(select auth.uid()))
  returning id into v_id;
  insert into public.radar_audit(action,target_id,actor_id)
  values('evidence_published',p_report_id,(select auth.uid()));
  return v_id;
end; $$;

create or replace function public.radar_admin_revoke_public_evidence(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_path text;
declare v_report uuid;
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  delete from public.radar_public_evidence where id=p_id
  returning public_path,report_id into v_path,v_report;
  if v_path is null then raise exception 'Prova não encontrada' using errcode='22023'; end if;
  insert into public.radar_audit(action,target_id,actor_id)
  values('evidence_unpublished',v_report,(select auth.uid()));
  return v_path;
end; $$;

alter table public.radar_appeals
  add column if not exists recovery_email text,
  add column if not exists identity_status text not null default 'unverified'
    check (identity_status in ('unverified','verified')),
  add column if not exists verified_tiktok_user_id text;

create or replace function public.radar_set_appeal_contact(p_appeal_id uuid,p_protocol text,p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_email is null or pg_catalog.btrim(p_email)='' then return; end if;
  if pg_catalog.char_length(p_email)>150 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido' using errcode='22023'; end if;
  update public.radar_appeals set recovery_email=pg_catalog.btrim(p_email)
  where id=p_appeal_id and protocol_hash=pg_catalog.encode(
    extensions.digest(pg_catalog.upper(p_protocol),'sha256'),'hex');
  if not found then raise exception 'Recurso não encontrado' using errcode='22023'; end if;
end; $$;

create table if not exists public.radar_appeal_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  report_id uuid not null references public.radar_reports(id) on delete cascade,
  handle text not null,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  verified_at timestamptz,
  verified_tiktok_user_id text,
  attempts integer not null default 0
);
create index if not exists radar_appeal_challenges_report_idx
  on public.radar_appeal_challenges(report_id,created_at desc);
alter table public.radar_appeal_challenges enable row level security;
revoke all on public.radar_appeal_challenges from anon, authenticated;
grant select, insert, update on public.radar_appeal_challenges to service_role;
grant execute on function public.radar_fold_handle(text) to service_role;

create or replace function public.radar_bind_appeal_identity(
  p_appeal_id uuid,p_protocol text,p_challenge_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user text;
begin
  select c.verified_tiktok_user_id into v_user
  from public.radar_appeal_challenges c
  join public.radar_appeals a on a.report_id=c.report_id
  where a.id=p_appeal_id and c.id=p_challenge_id and c.verified_at is not null
    and c.expires_at>now() and c.verified_at>now()-interval '30 minutes'
    and a.protocol_hash=pg_catalog.encode(extensions.digest(pg_catalog.upper(p_protocol),'sha256'),'hex');
  if v_user is null then return false; end if;
  update public.radar_appeals set identity_status='verified',verified_tiktok_user_id=v_user
  where id=p_appeal_id;
  return true;
end; $$;

create table if not exists public.radar_privacy_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  report_id uuid references public.radar_reports(id),
  contact text,
  message text not null check (pg_catalog.char_length(message) between 20 and 1500),
  protocol_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','resolved')),
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.radar_privacy_requests enable row level security;
revoke all on public.radar_privacy_requests from anon, authenticated;

create or replace function public.radar_create_privacy_request(
  p_report_id uuid,p_contact text,p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_protocol text := pg_catalog.upper(pg_catalog.encode(extensions.gen_random_bytes(16),'hex'));
declare v_id uuid;
begin
  if p_report_id is not null and not exists(select 1 from public.radar_reports where id=p_report_id) then
    raise exception 'Relato indisponível' using errcode='22023'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_message,''))) not between 20 and 1500 then
    raise exception 'Descreva o pedido em 20 a 1500 caracteres' using errcode='22023'; end if;
  if pg_catalog.char_length(coalesce(p_contact,''))>150 then
    raise exception 'Contato muito longo' using errcode='22023'; end if;
  insert into public.radar_privacy_requests(report_id,contact,message,protocol_hash)
  values(p_report_id,nullif(pg_catalog.btrim(p_contact),''),
    pg_catalog.btrim(p_message),
    pg_catalog.encode(extensions.digest(v_protocol,'sha256'),'hex'))
  returning id into v_id;
  return pg_catalog.jsonb_build_object('id',v_id,'protocol',v_protocol);
end; $$;

create or replace function public.radar_privacy_request_status(p_protocol text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('status',status,'admin_note',admin_note,
    'created_at',created_at,'reviewed_at',reviewed_at)
  from public.radar_privacy_requests
  where p_protocol ~ '^[0-9A-Fa-f]{32}$' and
    protocol_hash=pg_catalog.encode(extensions.digest(pg_catalog.upper(p_protocol),'sha256'),'hex');
$$;

create or replace function public.radar_admin_dashboard_v3()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  return public.radar_admin_dashboard_v2() || pg_catalog.jsonb_build_object(
    'privacy_requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',q.id,'report_id',q.report_id,'contact',q.contact,'message',q.message,
      'status',q.status,'admin_note',q.admin_note,'created_at',q.created_at)
      order by q.created_at desc) from public.radar_privacy_requests q),'[]'::jsonb),
    'appeal_contacts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',a.id,'recovery_email',a.recovery_email,'identity_status',a.identity_status))
      from public.radar_appeals a),'[]'::jsonb));
end;
$$;

create or replace function public.radar_admin_review_privacy_request(
  p_id uuid,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  update public.radar_privacy_requests
  set status='resolved',admin_note=pg_catalog.left(pg_catalog.btrim(coalesce(p_note,'')),500),
      reviewed_at=now() where id=p_id;
  if not found then raise exception 'Pedido não encontrado' using errcode='22023'; end if;
  insert into public.radar_audit(action,target_id,actor_id)
  values('privacy_request_resolved',p_id,(select auth.uid()));
end; $$;

revoke execute on function public.radar_recent_reports() from public,anon,authenticated;
revoke execute on function public.radar_check_upload_secret(text,text) from public,anon,authenticated;
revoke execute on function public.radar_report_detail(uuid) from public,anon,authenticated;
revoke execute on function public.radar_admin_approve_public_evidence(uuid,text,text,text) from public,anon,authenticated;
revoke execute on function public.radar_admin_revoke_public_evidence(uuid) from public,anon,authenticated;
revoke execute on function public.radar_create_privacy_request(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.radar_privacy_request_status(text) from public,anon,authenticated;
revoke execute on function public.radar_admin_dashboard_v3() from public,anon,authenticated;
revoke execute on function public.radar_bind_appeal_identity(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.radar_set_appeal_contact(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.radar_admin_review_privacy_request(uuid,text) from public,anon,authenticated;
grant execute on function public.radar_recent_reports() to anon,authenticated;
grant execute on function public.radar_check_upload_secret(text,text) to service_role;
grant execute on function public.radar_report_detail(uuid) to anon,authenticated;
grant execute on function public.radar_admin_approve_public_evidence(uuid,text,text,text) to authenticated;
grant execute on function public.radar_admin_revoke_public_evidence(uuid) to authenticated;
grant execute on function public.radar_create_privacy_request(uuid,text,text) to anon,authenticated;
grant execute on function public.radar_privacy_request_status(text) to anon,authenticated;
grant execute on function public.radar_admin_dashboard_v3() to authenticated;
grant execute on function public.radar_bind_appeal_identity(uuid,text,uuid) to anon,authenticated;
grant execute on function public.radar_set_appeal_contact(uuid,text,text) to anon,authenticated;
grant execute on function public.radar_admin_review_privacy_request(uuid,text) to authenticated;
commit;

