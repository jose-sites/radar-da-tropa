-- Transactional fixtures; no production report or account persists.
begin;
do $test$
declare s uuid:=extensions.gen_random_uuid(); p uuid:=extensions.gen_random_uuid(); a uuid; b uuid; hidden uuid; d jsonb;
begin
 insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash) values(s,'TEST DOSSIER','TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)));
 insert into public.radar_profiles(id,tiktok_user_id,current_handle) values(p,'fixture_'||p::text,'dossier_new');
 insert into public.radar_profile_aliases(profile_id,handle) values(p,'dossier_old'),(p,'dossier_new');
 insert into public.radar_reports(streamer_id,profile_id,handle,reason,status,category) values(s,p,'dossier_old','Published transaction fixture one','published','outro') returning id into a;
 insert into public.radar_reports(streamer_id,profile_id,handle,reason,status,category) values(s,p,'dossier_new','Published transaction fixture two','published','outro') returning id into b;
 insert into public.radar_reports(streamer_id,profile_id,handle,reason,status,category) values(s,p,'dossier_new','PRIVATE MUST NEVER APPEAR','pending','outro') returning id into hidden;
 insert into public.radar_reports(streamer_id,handle,reason,status,category) values(s,'dossier_new','Unconfirmed same handle must stay separate','published','outro');
 d:=public.radar_profile_dossier(a,1,0);
 if (d->>'total_reports')::int<>2 or jsonb_array_length(d->'reports')<>1 then raise exception 'Count or pagination wrong'; end if;
 if jsonb_array_length(d->'aliases')<>2 or d->'profile'->>'handle'<>'dossier_new' then raise exception 'Stable identity or aliases missing'; end if;
 if d::text like '%PRIVATE%' or d::text like '%pin_hash%' or d::text like '%protocol%' then raise exception 'Private data exposed'; end if;
 if public.radar_profile_dossier(hidden) is not null then raise exception 'Pending report accessible'; end if;
 if (public.radar_profile_dossier(a,1,1)->'reports'->0->>'id')=(d->'reports'->0->>'id') then raise exception 'Pagination repeats row'; end if;
 d:=public.radar_profile_dossier(a,50,0);
 if d::text like '%Unconfirmed same%' then raise exception 'Unconfirmed identity incorrectly merged'; end if;
end $test$;
select 'PASS dossier: confirmed grouping, aliases, pagination and private-data exclusion' as verification;
rollback;
