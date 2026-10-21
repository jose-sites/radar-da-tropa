-- Run with an administrative SQL connection. All fixture changes are rolled back.
begin;
do $test$
declare
  streamer uuid:=extensions.gen_random_uuid();
  baseline integer;
  groups jsonb;
  owner_id uuid;
  denied boolean:=false;
begin
  insert into public.radar_streamers(id,display_name,pin_prefix,pin_last4,pin_hash)
    values(streamer,'TESTE TRANSACIONAL','TEST','----',extensions.crypt(pg_catalog.encode(extensions.gen_random_bytes(20),'hex'),extensions.gen_salt('bf',10)));
  select (public.radar_public_stats()->>'published_reports')::int into baseline;
  insert into public.radar_reports(streamer_id,handle,reason,status,category) values
    (streamer,'transaction_fixture_a','Relato temporário de teste de agrupamento','published','outro'),
    (streamer,'TRANSACTION_FIXTURE_A','Segundo relato temporário do mesmo perfil','published','outro'),
    (streamer,'transaction_fixture_4','Outro perfil com nome parecido, sem fusão','published','outro'),
    (streamer,'transaction_fixture_private','Este relato privado não pode aparecer','pending','outro');
  groups:=public.radar_public_groups('transaction_fixture',24,0);
  if (groups->>'total_profiles')::int<>2 then raise exception 'Agrupamento incorreto'; end if;
  if not exists(select 1 from jsonb_array_elements(groups->'groups') g where (g->>'report_count')::int=2) then raise exception 'Mesmo perfil não foi agrupado'; end if;
  if (public.radar_public_stats()->>'published_reports')::int<>baseline+3 then raise exception 'Relato privado incluído na estatística'; end if;
  begin perform public.radar_admin_set_verified(streamer,true); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Selo concedido sem administrador'; end if;
  select user_id into owner_id from public.radar_admins limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id::text,'role','authenticated')::text,true);
  perform public.radar_admin_set_verified(streamer,true);
  groups:=public.radar_public_groups('transaction_fixture',24,0);
  if not exists(select 1 from jsonb_array_elements(groups->'groups') g where (g->>'streamer_verified')::boolean) then raise exception 'Selo ausente'; end if;
  if has_table_privilege('anon','public.radar_upload_tickets','select') then raise exception 'Tickets privados acessíveis'; end if;
  if has_function_privilege('anon','public.radar_admin_dashboard_v4()','execute') then raise exception 'Dashboard acessível anonimamente'; end if;
end;
$test$;
rollback;
