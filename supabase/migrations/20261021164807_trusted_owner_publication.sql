begin;
alter table public.radar_streamers add column auto_publish_by uuid references auth.users(id);
alter table public.radar_reports add column auto_publish_token uuid, add column auto_publish_started_at timestamptz;

create or replace function public.radar_streamer_for_pin(p_pin text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_pin text:=pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_pin,''),'[^0-9a-fA-F]','','g')); v_id uuid;
begin
 if v_pin !~ '^([0-9]{10}|[0-9A-F]{12}|[0-9A-F]{20})$' then return null; end if;
 select s.id into v_id from public.radar_streamers s
 where s.is_active and s.pin_prefix=pg_catalog.left(v_pin,4) and s.pin_hash=extensions.crypt(v_pin,s.pin_hash)
 and (pg_catalog.length(v_pin)<>10 or exists(select 1 from public.radar_admins a where a.user_id=s.auto_publish_by)) limit 1;
 return v_id;
end; $$;
revoke all on function public.radar_streamer_for_pin(text) from public,anon,authenticated;

create or replace function public.radar_verify_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_headers jsonb;v_ip text;v_count integer;
begin
 begin v_headers:=nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb; exception when others then v_headers:='{}'::jsonb; end;
 v_ip:=pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_headers->>'x-real-ip',v_headers->>'x-forwarded-for',''),'^(.*,)[[:space:]]*',''));
 if v_ip<>'' then
  insert into public.radar_pin_attempts(ip_hash,window_start,attempts)
  values(pg_catalog.encode(extensions.digest(v_ip,'sha256'),'hex'),pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch',now())/900)*900),1)
  on conflict(ip_hash,window_start) do update set attempts=public.radar_pin_attempts.attempts+1 returning attempts into v_count;
  if v_count>25 then return null; end if;
 end if;
 v_id:=public.radar_streamer_for_pin(p_pin);
 return (select pg_catalog.jsonb_build_object('id',s.id,'name',s.display_name,'can_auto_publish',exists(select 1 from public.radar_admins a where a.user_id=s.auto_publish_by)) from public.radar_streamers s where s.id=v_id);
end; $$;
revoke all on function public.radar_verify_pin(text) from public;
grant execute on function public.radar_verify_pin(text) to anon,authenticated,service_role;

-- Only the Edge Function can acquire a publication lease, copy the validated
-- attachments, and commit the report. Other streamers keep manual moderation.
create function public.radar_begin_owned_publication(p_pin text,p_report_id uuid,p_token uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;r public.radar_reports%rowtype;tickets jsonb;
begin
 s:=public.radar_verify_pin(p_pin);
 if s is null or not coalesce((s->>'can_auto_publish')::boolean,false) then return pg_catalog.jsonb_build_object('denied',true); end if;
 select * into r from public.radar_reports where id=p_report_id and streamer_id=(s->>'id')::uuid for update;
 if not found or r.status='rejected' or p_token is null or p_expected is null or p_expected not between 0 and 3 then return pg_catalog.jsonb_build_object('denied',true); end if;
 if r.status='published' then return pg_catalog.jsonb_build_object('published',true,'proof_count',(select count(*) from public.radar_public_evidence where report_id=r.id)); end if;
 if r.auto_publish_token is not null and r.auto_publish_token<>p_token and r.auto_publish_started_at>now()-interval '3 minutes' then return pg_catalog.jsonb_build_object('busy',true); end if;
 if (select count(*) from public.radar_upload_tickets where context='report' and target_id=r.id)<>p_expected
 or exists(select 1 from public.radar_upload_tickets where context='report' and target_id=r.id and (verified_at is null or rejection_reason is not null)) then return pg_catalog.jsonb_build_object('incomplete',true); end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('path',object_path,'mime',detected_mime) order by object_path),'[]'::jsonb) into tickets from public.radar_upload_tickets where context='report' and target_id=r.id;
 update public.radar_reports set auto_publish_token=p_token,auto_publish_started_at=now() where id=r.id;
 return pg_catalog.jsonb_build_object('tickets',tickets);
end; $$;
revoke all on function public.radar_begin_owned_publication(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.radar_begin_owned_publication(text,uuid,uuid,integer) to service_role;

alter table public.radar_public_evidence drop constraint if exists radar_public_evidence_mime_check;
alter table public.radar_public_evidence add constraint radar_public_evidence_mime_check check(mime in ('image/jpeg','image/png','image/webp','video/mp4'));
update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4'] where id='radar-public-evidence';

create function public.radar_finish_owned_publication(p_report_id uuid,p_token uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.radar_reports%rowtype;owner_id uuid;item jsonb;v_count integer;
begin
 select * into r from public.radar_reports where id=p_report_id for update;
 if not found or r.status<>'pending' or r.auto_publish_token is distinct from p_token or r.auto_publish_started_at<now()-interval '3 minutes' then raise exception 'Publicação não autorizada ou encerrada' using errcode='42501'; end if;
 select s.auto_publish_by into owner_id from public.radar_streamers s join public.radar_admins a on a.user_id=s.auto_publish_by where s.id=r.streamer_id and s.is_active;
 if owner_id is null then raise exception 'Publicação automática desativada' using errcode='42501'; end if;
 if p_evidence is null or pg_catalog.jsonb_typeof(p_evidence)<>'array' then raise exception 'Anexos inválidos' using errcode='22023'; end if;
 v_count:=pg_catalog.jsonb_array_length(p_evidence);
 if v_count>3 or v_count<>(select count(*) from public.radar_upload_tickets where context='report' and target_id=r.id)
 or v_count<>(select count(distinct e->>'path') from pg_catalog.jsonb_array_elements(p_evidence)e) then raise exception 'Envio de provas incompleto' using errcode='22023'; end if;
 for item in select value from pg_catalog.jsonb_array_elements(p_evidence) loop
  if not exists(select 1 from public.radar_upload_tickets t where t.context='report' and t.target_id=r.id and t.object_path=item->>'path' and t.verified_at is not null and t.rejection_reason is null and t.detected_mime=item->>'mime')
  or not exists(select 1 from storage.objects o where o.bucket_id='radar-public-evidence' and o.name=item->>'path' and o.metadata->>'mimetype'=item->>'mime')
  or (item->>'path') !~ ('^reports/'||r.id::text||'/[0-9a-f-]{36}[.](jpg|png|webp|mp4)$') then raise exception 'Prova não verificada' using errcode='22023'; end if;
  insert into public.radar_public_evidence(report_id,source_path,public_path,mime,approved_by) values(r.id,item->>'path',item->>'path',item->>'mime',owner_id);
 end loop;
 update public.radar_reports set status='published',reviewed_at=now(),review_note='Publicado automaticamente pelo acesso do administrador',auto_publish_token=null,auto_publish_started_at=null where id=r.id;
 insert into public.radar_audit(action,target_id,actor_id) values('owner_report_auto_published',r.id,owner_id);
 return pg_catalog.jsonb_build_object('published',true,'proof_count',v_count);
end; $$;
revoke all on function public.radar_finish_owned_publication(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.radar_finish_owned_publication(uuid,uuid,jsonb) to service_role;

create function public.radar_abort_owned_publication(p_report_id uuid,p_token uuid)
returns void language sql security definer set search_path='' as $$
 update public.radar_reports set auto_publish_token=null,auto_publish_started_at=null where id=p_report_id and status='pending' and auto_publish_token=p_token;
$$;
revoke all on function public.radar_abort_owned_publication(uuid,uuid) from public,anon,authenticated;
grant execute on function public.radar_abort_owned_publication(uuid,uuid) to service_role;
commit;
