begin;
do $test$
declare a uuid:=extensions.gen_random_uuid(); b uuid:=extensions.gen_random_uuid(); c uuid:=extensions.gen_random_uuid(); d jsonb;
begin
 insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash,is_active,is_verified) values
 (a,'TEST PUBLIC VERIFIED '||a,'TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)),true,true),
 (b,'TEST UNVERIFIED '||b,'TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)),true,false),
 (c,'TEST INACTIVE '||c,'TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)),false,true);
 d:=public.radar_public_verified_streamers();
 if not d @> jsonb_build_array(jsonb_build_object('name','TEST PUBLIC VERIFIED '||a)) then raise exception 'Active verified streamer missing'; end if;
 if d::text like '%TEST UNVERIFIED%' or d::text like '%TEST INACTIVE%' then raise exception 'Unverified or inactive streamer exposed'; end if;
 if exists(select 1 from jsonb_array_elements(d) item where (select count(*) from jsonb_object_keys(item))<>1 or not item ? 'name') then raise exception 'Unexpected public fields'; end if;
 if not has_function_privilege('anon','public.radar_public_verified_streamers()','execute') or not has_function_privilege('authenticated','public.radar_public_verified_streamers()','execute') then raise exception 'Public access missing'; end if;
 update public.radar_streamers set is_verified=false where id=a;
 if public.radar_public_verified_streamers() @> jsonb_build_array(jsonb_build_object('name','TEST PUBLIC VERIFIED '||a)) then raise exception 'Revoked badge remains visible'; end if;
end $test$;
select 'PASS verified directory: active badge only, no PIN or private data, revocation' as verification;
rollback;
