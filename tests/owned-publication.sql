begin;
do $test$
declare owner_id uuid;owner_streamer uuid:=extensions.gen_random_uuid();ordinary uuid:=extensions.gen_random_uuid();r uuid;other_report uuid;token uuid:=extensions.gen_random_uuid();t uuid:=extensions.gen_random_uuid();path text;s jsonb;denied boolean:=false;
begin
 select user_id into owner_id from public.radar_admins limit 1;
 insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash,auto_publish_by) values(owner_streamer,'TEST OWNER','1234','2345',extensions.crypt('1234512345',extensions.gen_salt('bf',10)),owner_id);
 insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash) values(ordinary,'TEST ORDINARY','ABCD','ABCD',extensions.crypt('ABCDABCDABCD',extensions.gen_salt('bf',10)));
 if public.radar_streamer_for_pin('1 2 3 4 5 1 2 3 4 5')<>owner_streamer then raise exception 'Owner short PIN rejected'; end if;
 if not (public.radar_verify_pin('1234512345')->>'can_auto_publish')::boolean then raise exception 'Owner capability missing'; end if;
 r:=public.radar_submit_report_v2('1234512345','owner_fixture','Relato transacional para testar publicação');
 other_report:=public.radar_submit_report_v2('ABCDABCDABCD','other_fixture','Relato transacional de outro streamer');
 if not (public.radar_begin_owned_publication('1234512345',other_report,token,0)->>'denied')::boolean then raise exception 'Cross-owner publication allowed'; end if;
 if not (public.radar_begin_owned_publication('ABCDABCDABCD',other_report,token,0)->>'denied')::boolean then raise exception 'Ordinary access can self-publish'; end if;
 path:='reports/'||r::text||'/'||t::text||'.jpg';
 insert into public.radar_upload_tickets(id,context,target_id,object_path) values(t,'report',r,path);
 if not (public.radar_begin_owned_publication('1234512345',r,token,1)->>'incomplete')::boolean then raise exception 'Unverified proof accepted'; end if;
 update public.radar_upload_tickets set verified_at=now(),detected_mime='image/jpeg' where id=t;
 s:=public.radar_begin_owned_publication('1234512345',r,token,1);
 if jsonb_array_length(s->'tickets')<>1 then raise exception 'Missing publication context'; end if;
 if not (public.radar_begin_owned_publication('1234512345',r,extensions.gen_random_uuid(),1)->>'busy')::boolean then raise exception 'Concurrent publication not blocked'; end if;
 begin perform public.radar_finish_owned_publication(r,token,jsonb_build_array(jsonb_build_object('path',path,'mime','image/jpeg'))); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Missing public object accepted'; end if;
 -- Storage metadata fixture only, no real object is written; rollback removes it.
 insert into storage.objects(bucket_id,name,metadata) values('radar-public-evidence',path,'{"mimetype":"image/jpeg"}'::jsonb);
 s:=public.radar_finish_owned_publication(r,token,jsonb_build_array(jsonb_build_object('path',path,'mime','image/jpeg')));
 if not (s->>'published')::boolean or (select status from public.radar_reports where id=r)<>'published' then raise exception 'Publication failed'; end if;
 if (select approved_by from public.radar_public_evidence where report_id=r)<>owner_id then raise exception 'Wrong publication authority'; end if;
 if not (public.radar_begin_owned_publication('1234512345',r,token,1)->>'published')::boolean then raise exception 'Retry not idempotent'; end if;
 if (select status from public.radar_reports where id=other_report)<>'pending' then raise exception 'Another streamer moderation changed'; end if;
 update public.radar_streamers set auto_publish_by=null where id=owner_streamer;
 if public.radar_streamer_for_pin('1234512345') is not null then raise exception 'Short PIN active without owner permission'; end if;
 if has_function_privilege('anon','public.radar_begin_owned_publication(text,uuid,uuid,integer)','EXECUTE') or has_function_privilege('authenticated','public.radar_finish_owned_publication(uuid,uuid,jsonb)','EXECUTE') then raise exception 'Public service-only publication API'; end if;
end $test$;
select 'PASS owner publication: PIN, ownership, verification, concurrency, retry, revocation and ordinary moderation' as verification;
rollback;
