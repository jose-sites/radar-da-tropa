-- Expose only a public role marker; keep the owner's user ID and PIN private.
create or replace function public.radar_public_verified_streamers()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('name',s.display_name,'handle',p.current_handle,'avatar_path',p.avatar_path,
   'is_administration',exists(select 1 from public.radar_admins a where a.user_id=s.auto_publish_by))
   order by lower(s.display_name),s.id),'[]'::jsonb)
 from public.radar_streamers s left join public.radar_profiles p on p.id=s.tiktok_profile_id
 where s.is_active is true and s.is_verified is true;
$$;
revoke all on function public.radar_public_verified_streamers() from public;
grant execute on function public.radar_public_verified_streamers() to anon,authenticated;
