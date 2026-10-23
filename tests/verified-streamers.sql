-- All fixture records and links are rolled back.
begin;
do $test$
declare a uuid:=extensions.gen_random_uuid(); b uuid:=extensions.gen_random_uuid(); c uuid:=extensions.gen_random_uuid(); p uuid:=extensions.gen_random_uuid(); q uuid:=extensions.gen_random_uuid(); owner_id uuid; d jsonb; denied boolean:=false;
begin
 insert into public.radar_profiles(id,tiktok_user_id,current_handle,avatar_path) values
 (p,'9'||floor(random()*1000000000000000)::bigint::text,'fixture_'||substr(replace(p::text,'-',''),1,20),p::text||'.webp'),
 (q,'8'||floor(random()*1000000000000000)::bigint::text,'fixture_'||substr(replace(q::text,'-',''),1,20),null);
 insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash,is_active,is_verified,tiktok_profile_id) values
 (a,'TEST PUBLIC VERIFIED '||a,'TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)),true,true,p),
 (b,'TEST UNVERIFIED '||b,'TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)),true,false,q),
 (c,'TEST INACTIVE '||c,'TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)),false,true,q);
 d:=public.radar_public_verified_streamers();
 if not d @> jsonb_build_array(jsonb_build_object('name','TEST PUBLIC VERIFIED '||a,'avatar_path',p::text||'.webp')) then raise exception 'Active verified streamer photo missing'; end if;
 if d::text like '%TEST UNVERIFIED%' or d::text like '%TEST INACTIVE%' then raise exception 'Unverified or inactive streamer exposed'; end if;
 if exists(select 1 from jsonb_array_elements(d) item where (select count(*) from jsonb_object_keys(item))<>4 or not item ?& array['name','handle','avatar_path','is_administration']) then raise exception 'Unexpected public fields'; end if;
 update public.radar_profiles set current_handle='fixture_renamed' where id=p;
 if not public.radar_public_verified_streamers() @> jsonb_build_array(jsonb_build_object('name','TEST PUBLIC VERIFIED '||a,'handle','fixture_renamed')) then raise exception 'Renamed account lost'; end if;
 if not has_function_privilege('anon','public.radar_public_verified_streamers()','execute') then raise exception 'Public access missing'; end if;
 if has_function_privilege('anon','public.radar_admin_link_streamer_profile(uuid,uuid)','execute') or has_function_privilege('anon','public.radar_admin_dashboard_v8()','execute') then raise exception 'Admin endpoint public'; end if;
 begin perform public.radar_admin_link_streamer_profile(a,q); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Non-admin linked account'; end if;
 select user_id into owner_id from public.radar_admins limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id::text,'role','authenticated')::text,true);
 if not public.radar_admin_claim_streamer_lookup(a) or public.radar_admin_claim_streamer_lookup(a) then raise exception 'Lookup cooldown not atomic'; end if;
 perform public.radar_admin_link_streamer_profile(a,p);
 if not (select is_verified from public.radar_streamers where id=a) then raise exception 'Same identity unexpectedly lost badge'; end if;
 perform public.radar_admin_link_streamer_profile(a,q);
 if (select is_verified from public.radar_streamers where id=a) then raise exception 'Badge transferred to another person'; end if;
 perform public.radar_admin_set_verified(a,true);
 d:=public.radar_admin_dashboard_v8();
 if not exists(select 1 from jsonb_array_elements(d->'streamers') item where item->>'id'=a::text and item->>'tiktok_profile_id'=q::text) then raise exception 'Admin missing profile fields'; end if;
 perform public.radar_admin_link_streamer_profile(a,null);
 if public.radar_public_verified_streamers() @> jsonb_build_array(jsonb_build_object('name','TEST PUBLIC VERIFIED '||a)) then raise exception 'Unlinked account still verified'; end if;
end $test$;
select 'PASS verified directory: photos, stable rename, privacy, admin authorization, cooldown and badge reset' as verification;
rollback;
