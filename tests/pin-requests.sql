-- All requests, audit events and rate-limit fixtures roll back.
begin;
do $test$
declare token text:=pg_catalog.encode(extensions.gen_random_bytes(16),'hex');r jsonb;r2 jsonb;st jsonb;owner_id uuid;n integer;denied boolean:=false;i integer;
begin
 perform set_config('request.headers','{"x-forwarded-for":"192.0.2.239"}',true);
 r:=public.radar_submit_pin_request(token,'Fixture Streamer','pin_fixture_test','Contexto privado de teste transacional','5527999999999');
 r2:=public.radar_submit_pin_request(token,'Outro nome','different','Retry must return same request',null);
 if r->>'id'<>r2->>'id' then raise exception 'Duplicate request on retry'; end if;
 st:=public.radar_pin_request_status(lower(token));
 if st->>'status'<>'received' or st ? 'contact' or st ? 'context' or st ? 'admin_note' or st ? 'protocol_hash' then raise exception 'Status response leaks private data'; end if;
 if public.radar_pin_request_status('invalid') is not null or public.radar_pin_request_status(repeat('0',32)) is not null then raise exception 'Unknown protocol accepted'; end if;
 begin perform public.radar_admin_update_pin_request((r->>'id')::uuid,'responded','Unauthorized',''); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous admin update allowed'; end if;
 denied:=false;
 begin perform public.radar_submit_pin_request(pg_catalog.encode(extensions.gen_random_bytes(16),'hex'),'Fixture Streamer','PIN_FIXTURE_TEST','Duplicate handle request',''); exception when sqlstate 'P0001' then denied:=true; end;
 if not denied then raise exception 'Handle cooldown missing'; end if;
 select user_id into owner_id from public.radar_admins limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id::text,'role','authenticated')::text,true);
 perform public.radar_admin_update_pin_request((r->>'id')::uuid,'in_analysis','Estamos analisando.','INTERNAL PRIVATE NOTE');
 perform public.radar_admin_update_pin_request((r->>'id')::uuid,'responded','Entre em contato pelo WhatsApp.','INTERNAL PRIVATE NOTE');
 st:=public.radar_pin_request_status(token);
 if st->>'status'<>'responded' or st->>'reply'<>'Entre em contato pelo WhatsApp.' or st::text like '%INTERNAL%' then raise exception 'Status or public reply incorrect'; end if;
 denied:=false;
 begin perform public.radar_admin_update_pin_request((r->>'id')::uuid,'approved'); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Invalid status accepted'; end if;
 if not (public.radar_admin_dashboard_v6() ? 'pin_requests') then raise exception 'Missing private dashboard requests'; end if;
 if (public.radar_admin_dashboard_v6()->'pin_requests')::text like '%protocol_hash%' then raise exception 'Protocol hash exposed in dashboard'; end if;
 if has_table_privilege('anon','public.radar_pin_requests','SELECT') or has_table_privilege('authenticated','public.radar_pin_requests','SELECT') then raise exception 'Direct table access allowed'; end if;
 -- One fixture already consumed a request. Four more reach the hourly limit.
 for i in 1..4 loop
  perform public.radar_submit_pin_request(pg_catalog.encode(extensions.gen_random_bytes(16),'hex'),'Fixture Streamer','pin_rate_fixture_'||i::text,'Contexto de teste do limite de pedidos',null);
 end loop;
 denied:=false;
 begin perform public.radar_submit_pin_request(pg_catalog.encode(extensions.gen_random_bytes(16),'hex'),'Fixture Streamer','pin_rate_fixture_6','Contexto de teste do limite de pedidos',null); exception when sqlstate 'P0001' then denied:=true; end;
 if not denied then raise exception 'Hourly rate limit missing'; end if;
end $test$;
select 'PASS PIN requests: idempotency, private data, admin guards, statuses, cooldown and hourly limit' as verification;
rollback;
