-- Mostra somente relatos publicados, em ordem da decisão de moderação.
create or replace function public.radar_recent_approved_reports()
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
  from public.radar_reports r
  left join public.radar_profiles p on p.id=r.profile_id
  where r.status='published'
  order by r.reviewed_at desc nulls last,r.created_at desc
  limit 12;
$$;

revoke execute on function public.radar_recent_approved_reports() from public,anon,authenticated;
grant execute on function public.radar_recent_approved_reports() to anon,authenticated;
