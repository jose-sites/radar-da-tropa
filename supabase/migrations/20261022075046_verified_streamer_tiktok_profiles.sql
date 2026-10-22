begin;
alter table public.radar_streamers
  add column tiktok_profile_id uuid references public.radar_profiles(id) on delete set null,
  add column tiktok_lookup_at timestamptz;
create index radar_streamers_tiktok_profile_idx on public.radar_streamers(tiktok_profile_id) where tiktok_profile_id is not null;

-- Reuse stable TikTok identities and the existing avatar cache/refresh queue.
create or replace function public.radar_public_verified_streamers()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('name',s.display_name,'handle',p.current_handle,'avatar_path',p.avatar_path)
   order by lower(s.display_name),s.id),'[]'::jsonb)
 from public.radar_streamers s left join public.radar_profiles p on p.id=s.tiktok_profile_id
 where s.is_active is true and s.is_verified is true;
$$;
revoke all on function public.radar_public_verified_streamers() from public;
grant execute on function public.radar_public_verified_streamers() to anon,authenticated;

create or replace function public.radar_admin_dashboard_v8()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 result:=public.radar_admin_dashboard_v7();
 return result || jsonb_build_object('streamers',coalesce((select jsonb_agg(item || jsonb_build_object(
   'tiktok_profile_id',s.tiktok_profile_id,'tiktok_handle',p.current_handle,'avatar_path',p.avatar_path))
   from jsonb_array_elements(result->'streamers') item join public.radar_streamers s on s.id=(item->>'id')::uuid
   left join public.radar_profiles p on p.id=s.tiktok_profile_id),'[]'::jsonb));
end; $$;
revoke all on function public.radar_admin_dashboard_v8() from public,anon;
grant execute on function public.radar_admin_dashboard_v8() to authenticated;

-- Atomic reservation prevents parallel clicks from flooding the public provider.
create or replace function public.radar_admin_claim_streamer_lookup(p_streamer_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 update public.radar_streamers set tiktok_lookup_at=clock_timestamp() where id=p_streamer_id
   and (tiktok_lookup_at is null or tiktok_lookup_at<clock_timestamp()-interval '1 minute');
 return found;
end; $$;
revoke all on function public.radar_admin_claim_streamer_lookup(uuid) from public,anon;
grant execute on function public.radar_admin_claim_streamer_lookup(uuid) to authenticated;

create or replace function public.radar_admin_link_streamer_profile(p_streamer_id uuid,p_profile_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare previous uuid;
begin
 if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 select tiktok_profile_id into previous from public.radar_streamers where id=p_streamer_id for update;
 if not found then raise exception 'Streamer não encontrado' using errcode='22023'; end if;
 if p_profile_id is not null and not exists(select 1 from public.radar_profiles where id=p_profile_id and tiktok_user_id ~ '^[0-9]{5,30}$' and current_handle ~ '^[A-Za-z0-9._]{2,40}$') then
   raise exception 'Perfil do TikTok não identificado' using errcode='22023';
 end if;
 -- A badge must never silently transfer to a different person.
 update public.radar_streamers set tiktok_profile_id=p_profile_id,
   is_verified=case when previous is distinct from p_profile_id then false else is_verified end,
   verified_at=case when previous is distinct from p_profile_id then null else verified_at end where id=p_streamer_id;
 insert into public.radar_audit(action,target_id,actor_id) values('streamer_tiktok_linked',p_streamer_id,(select auth.uid()));
end; $$;
revoke all on function public.radar_admin_link_streamer_profile(uuid,uuid) from public,anon;
grant execute on function public.radar_admin_link_streamer_profile(uuid,uuid) to authenticated;
commit;
