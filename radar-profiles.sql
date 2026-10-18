-- Fichas de contas TikTok. Executar uma vez após radar-upgrade.sql.
-- O @ original do relato nunca é sobrescrito; a conta vinculada fornece o @ atual.
begin;

create table if not exists public.radar_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  tiktok_user_id text not null unique,
  tiktok_sec_uid text,
  current_handle text not null check (current_handle ~ '^[A-Za-z0-9._]{2,40}$'),
  avatar_path text,
  last_checked_at timestamptz,
  last_attempt_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now()
);
create index if not exists radar_profiles_due_idx on public.radar_profiles(last_attempt_at nulls first);
alter table public.radar_profiles enable row level security;
revoke all on public.radar_profiles from anon, authenticated;

create table if not exists public.radar_profile_aliases (
  profile_id uuid not null references public.radar_profiles(id) on delete cascade,
  handle text not null check (handle ~ '^[A-Za-z0-9._]{2,40}$'),
  handle_key text generated always as (public.radar_fold_handle(handle)) stored,
  first_seen_at timestamptz not null default now(),
  primary key (profile_id, handle)
);
create index if not exists radar_profile_aliases_key_idx on public.radar_profile_aliases(handle_key);
alter table public.radar_profile_aliases enable row level security;
revoke all on public.radar_profile_aliases from anon, authenticated;

-- Apenas a função de serviço interna consulta e atualiza as fichas.
grant select, update on table public.radar_reports to service_role;
grant select, insert, update on table public.radar_profiles to service_role;
grant select, insert on table public.radar_profile_aliases to service_role;

alter table public.radar_reports
  add column if not exists profile_id uuid references public.radar_profiles(id),
  add column if not exists profile_resolution_attempt_at timestamptz,
  add column if not exists profile_resolution_error text;
create index if not exists radar_reports_profile_idx on public.radar_reports(profile_id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('radar-avatars','radar-avatars',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=2097152,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop function if exists public.radar_search_reports_v2(text,text);
create function public.radar_search_reports_v2(p_query text,p_category text default null)
returns table(
  id uuid, handle text, reason text, category text, event_date date,
  created_at timestamptz, old_handles jsonb, avatar_path text,
  profile_verified boolean, last_checked_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id,coalesce(p.current_handle,r.handle),r.reason,r.category,r.event_date,r.created_at,
    coalesce((select pg_catalog.jsonb_agg(a.handle order by a.first_seen_at)
      from public.radar_profile_aliases a where a.profile_id=p.id
        and pg_catalog.lower(a.handle)<>pg_catalog.lower(p.current_handle)),'[]'::jsonb),
    p.avatar_path,(p.id is not null),p.last_checked_at
  from public.radar_reports r left join public.radar_profiles p on p.id=r.profile_id
  where r.status='published'
    and pg_catalog.char_length(public.radar_fold_handle(coalesce(p_query,'')))>=2
    and (p_category is null or p_category='' or r.category=p_category)
    and (
      pg_catalog.strpos(public.radar_fold_handle(coalesce(p.current_handle,r.handle)),public.radar_fold_handle(p_query))>0
      or pg_catalog.strpos(r.handle_key,public.radar_fold_handle(p_query))>0
      or exists(select 1 from public.radar_profile_aliases a where a.profile_id=p.id
        and pg_catalog.strpos(a.handle_key,public.radar_fold_handle(p_query))>0)
    )
  order by r.created_at desc limit 100;
$$;
revoke execute on function public.radar_search_reports_v2(text,text) from public,anon,authenticated;
grant execute on function public.radar_search_reports_v2(text,text) to anon,authenticated;

create or replace function public.radar_admin_dashboard_v2()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
  select pg_catalog.jsonb_build_object(
    'streamers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',s.id,'name',s.display_name,'active',s.is_active,'created_at',s.created_at,
      'legacy_pin',pg_catalog.length(s.pin_hash)>0 and s.pin_last4<>'----') order by s.created_at desc)
      from public.radar_streamers s),'[]'::jsonb),
    'reports',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',r.id,'handle',coalesce(p.current_handle,r.handle),'original_handle',r.handle,
      'profile_verified',p.id is not null,'avatar_path',p.avatar_path,'last_checked_at',p.last_checked_at,
      'reason',r.reason,'category',r.category,'event_date',r.event_date,
      'review_note',r.review_note,'status',r.status,'created_at',r.created_at,'streamer_name',s.display_name,
      'evidence',coalesce((select pg_catalog.jsonb_agg(o.name order by o.created_at) from storage.objects o
        where o.bucket_id='radar-evidence' and o.name like 'reports/'||r.id::text||'/%'),'[]'::jsonb)) order by r.created_at desc)
      from public.radar_reports r join public.radar_streamers s on s.id=r.streamer_id
        left join public.radar_profiles p on p.id=r.profile_id),'[]'::jsonb),
    'appeals',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',a.id,'report_id',a.report_id,'handle',a.handle,'message',a.message,'status',a.status,
      'admin_note',a.admin_note,'created_at',a.created_at,'reviewed_at',a.reviewed_at,
      'report_handle',coalesce(p.current_handle,r.handle),'evidence',coalesce((select pg_catalog.jsonb_agg(o.name order by o.created_at)
        from storage.objects o where o.bucket_id='radar-evidence' and o.name like 'appeals/'||a.id::text||'/%'),'[]'::jsonb)) order by a.created_at desc)
      from public.radar_appeals a join public.radar_reports r on r.id=a.report_id
        left join public.radar_profiles p on p.id=r.profile_id),'[]'::jsonb),
    'audit',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('action',x.action,'created_at',x.created_at)
      order by x.created_at desc) from (select action,created_at from public.radar_audit order by created_at desc limit 20) x),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

commit;

