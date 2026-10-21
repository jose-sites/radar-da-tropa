begin;
do $test$
declare s uuid:=extensions.gen_random_uuid(); a uuid; hidden uuid; d jsonb;
begin
 insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash) values(s,'TEST PARTIAL','TEST','----',extensions.crypt('fixture-only',extensions.gen_salt('bf',10)));
 insert into public.radar_reports(streamer_id,handle,reason,status,category,public_profile_name,public_profile_checked_at)
 values(s,'partial_fixture','Transactional published report fixture','published','outro','Partial Name',now()) returning id into a;
 insert into public.radar_reports(streamer_id,handle,reason,status,category,public_profile_name,public_profile_checked_at)
 values(s,'private_fixture','PRIVATE fixture must remain private','pending','outro','PRIVATE NAME',now()) returning id into hidden;
 d:=public.radar_report_detail_v2(a);
 if d->>'public_profile_name'<>'Partial Name' or (d->>'profile_verified')::boolean then raise exception 'Partial name incorrectly confirmed'; end if;
 if public.radar_report_detail_v2(hidden) is not null then raise exception 'Pending data leaked'; end if;
 d:=public.radar_public_groups('partial_fixture');
 if d->'groups'->0->>'public_profile_name'<>'Partial Name' or (d->'groups'->0->>'profile_verified')::boolean then raise exception 'Grouping lost partial metadata boundary'; end if;
 if d::text like '%browser_lease%' or d::text like '%pin_hash%' then raise exception 'Private fields exposed'; end if;
 d:=public.radar_profile_dossier(a);
 if d->'profile'->>'public_profile_name'<>'Partial Name' then raise exception 'Dossier missing partial metadata'; end if;
 if has_table_privilege('anon','public.radar_reports','UPDATE') or has_table_privilege('anon','public.radar_reports','SELECT') then raise exception 'Direct table access granted'; end if;
end $test$;
select 'PASS partial metadata stays unverified; only published data exposed' as verification;
rollback;
