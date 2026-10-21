begin;
do $test$
declare s uuid:=extensions.gen_random_uuid();r uuid;p uuid;owner_id uuid;denied boolean:=false;d jsonb;
begin
 insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash) values(s,'TEST RESOLUTION','TEST','----',extensions.crypt('fixture',extensions.gen_salt('bf',10)));
 insert into public.radar_reports(streamer_id,handle,reason,status,category) values(s,'resolution_fixture','Relato temporário para testar resolução','published','outro') returning id into r;
 insert into public.radar_reports(streamer_id,handle,reason,status,category) values(s,'resolution_pending','Relato privado para testar resolução','pending','outro') returning id into p;
 begin perform public.radar_admin_resolve_report(r,'resolved','Pagamento confirmado pelas partes.'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous mutation allowed'; end if;
 select user_id into owner_id from public.radar_admins limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id::text,'role','authenticated')::text,true);
 perform public.radar_admin_resolve_report(r,'resolved','Pagamento confirmado pelas partes.');
 perform public.radar_admin_resolve_report(r,'resolved','Pagamento confirmado pelas partes.');
 d:=public.radar_report_detail_v2(r);
 if d->>'resolution_status'<>'resolved' or jsonb_array_length(d->'resolution_history')<>1 then raise exception 'Resolution or retry incorrect'; end if;
 if d::text like '%actor_id%' then raise exception 'Private actor exposed'; end if;
 if public.radar_public_groups('resolution_fixture',24,0)->'groups'->0->'reports'->0->>'resolution_status'<>'resolved' then raise exception 'Grouping missing state'; end if;
 perform public.radar_admin_resolve_report(r,'open','Acordo ainda depende de confirmação.');
 d:=public.radar_report_detail_v2(r);
 if d->>'resolution_status'<>'open' or jsonb_array_length(d->'resolution_history')<>2 or d->>'reason'<>'Relato temporário para testar resolução' then raise exception 'Reopening lost original history'; end if;
 denied:=false;
 begin perform public.radar_admin_resolve_report(p,'resolved','Relato privado não pode ser publicado.'); exception when invalid_parameter_value then denied:=true; end;
 if not denied or public.radar_report_detail_v2(p) is not null then raise exception 'Pending report leaked'; end if;
 if has_table_privilege('anon','public.radar_report_resolutions','SELECT') or has_function_privilege('anon','public.radar_admin_resolve_report(uuid,text,text)','EXECUTE') then raise exception 'Private mutation exposed'; end if;
end $test$;
select 'PASS resolution: admin-only update, idempotency, public status, original history, private report exclusion' as verification;
rollback;
