-- Public directory contains only names of active streamers with the Radar badge.
create or replace function public.radar_public_verified_streamers()
returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('name', s.display_name)
    order by lower(s.display_name), s.id), '[]'::jsonb)
  from public.radar_streamers s
  where s.is_active is true and s.is_verified is true;
$function$;
revoke all on function public.radar_public_verified_streamers() from public;
grant execute on function public.radar_public_verified_streamers() to anon, authenticated;
