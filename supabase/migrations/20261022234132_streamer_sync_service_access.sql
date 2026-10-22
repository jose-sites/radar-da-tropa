-- The internal sync can fill approved profile links, without reading PIN hashes
-- or granting badges. Anonymous/authenticated table privileges are unchanged.
grant select (id,display_name,is_active,is_verified,tiktok_profile_id,tiktok_lookup_at),
  update (tiktok_profile_id,tiktok_lookup_at)
on public.radar_streamers to service_role;
