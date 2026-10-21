begin;
create table public.radar_pin_requests (
 id uuid primary key default extensions.gen_random_uuid(),
 protocol_hash text not null unique,
 name text not null check(char_length(name) between 2 and 60),
 handle text not null check(handle ~ '^[A-Za-z0-9._]{2,40}$'),
 context text not null check(char_length(context) between 10 and 400),
 contact text check(contact is null or contact ~ '^[1-9][0-9]{9,14}$'),
 status text not null default 'received' check(status in ('received','in_analysis','responded')),
 public_reply text not null default '' check(char_length(public_reply)<=500),
 admin_note text not null default '' check(char_length(admin_note)<=500),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index radar_pin_requests_created_idx on public.radar_pin_requests(created_at desc,id);
create index radar_pin_requests_handle_idx on public.radar_pin_requests(lower(handle),created_at desc);
alter table public.radar_pin_requests enable row level security;
revoke all on public.radar_pin_requests from public,anon,authenticated;
create table public.radar_pin_request_limits (
 ip_hash text not null,window_start timestamptz not null,attempts integer not null,
 primary key(ip_hash,window_start)
);
alter table public.radar_pin_request_limits enable row level security;
revoke all on public.radar_pin_request_limits from public,anon,authenticated;

-- The client creates a cryptographically random secret before sending. Hashing it allows
-- safe, idempotent retries after a lost response without keeping the secret here.
create function public.radar_submit_pin_request(p_protocol text,p_name text,p_handle text,p_context text,p_contact text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_hash text; v_handle text:=pg_catalog.regexp_replace(pg_catalog.btrim(p_handle),'^@+','');
 v_row public.radar_pin_requests%rowtype; v_headers jsonb;v_ip text;v_count integer;
begin
 if p_protocol is null or p_protocol !~ '^[0-9a-fA-F]{32}$' then raise exception 'Protocolo inválido' using errcode='22023'; end if;
 v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.upper(p_protocol),'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hash,0));
 select * into v_row from public.radar_pin_requests where protocol_hash=v_hash;
 if not found then
   if p_name is null or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 2 and 60
     or v_handle is null or v_handle !~ '^[A-Za-z0-9._]{2,40}$'
     or p_context is null or pg_catalog.char_length(pg_catalog.btrim(p_context)) not between 10 and 400
     or (nullif(p_contact,'') is not null and p_contact !~ '^[1-9][0-9]{9,14}$')
   then raise exception 'Confira o nome, arroba, descrição e WhatsApp com país e DDD' using errcode='22023'; end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pin-handle:'||pg_catalog.lower(v_handle),0));
   if exists(select 1 from public.radar_pin_requests where pg_catalog.lower(handle)=pg_catalog.lower(v_handle) and created_at>now()-interval '10 minutes')
   then raise exception 'Já recebemos um pedido recente para este arroba. Consulte seu protocolo ou aguarde 10 minutos.' using errcode='P0001'; end if;
   begin v_headers:=nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb;
   exception when others then v_headers:='{}'::jsonb; end;
   -- Last forwarded address follows the gateway convention used by PIN validation.
   v_ip:=pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_headers->>'x-forwarded-for',v_headers->>'x-real-ip',''),'^(.*,)[[:space:]]*',''));
   if v_ip<>'' then
     insert into public.radar_pin_request_limits(ip_hash,window_start,attempts)
     values(pg_catalog.encode(extensions.digest('pin-request:'||v_ip,'sha256'),'hex'),pg_catalog.date_trunc('hour',now()),1)
     on conflict(ip_hash,window_start) do update set attempts=public.radar_pin_request_limits.attempts+1 returning attempts into v_count;
     if v_count>5 then raise exception 'Limite de pedidos atingido. Tente novamente em uma hora.' using errcode='P0001'; end if;
     delete from public.radar_pin_request_limits where window_start<now()-interval '1 day';
   end if;
   insert into public.radar_pin_requests(protocol_hash,name,handle,context,contact)
   values(v_hash,pg_catalog.btrim(p_name),v_handle,pg_catalog.btrim(p_context),nullif(p_contact,'')) returning * into v_row;
 end if;
 return pg_catalog.jsonb_build_object('id',v_row.id,'name',v_row.name,'handle',v_row.handle,'context',v_row.context,'status',v_row.status,'created_at',v_row.created_at);
end; $$;
revoke all on function public.radar_submit_pin_request(text,text,text,text,text) from public;
grant execute on function public.radar_submit_pin_request(text,text,text,text,text) to anon,authenticated;

create function public.radar_pin_request_status(p_protocol text)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('id',r.id,'name',r.name,'handle',r.handle,'status',r.status,'reply',r.public_reply,'created_at',r.created_at,'updated_at',r.updated_at)
 from public.radar_pin_requests r where p_protocol ~ '^[0-9a-fA-F]{32}$' and r.protocol_hash=pg_catalog.encode(extensions.digest(pg_catalog.upper(p_protocol),'sha256'),'hex');
$$;
revoke all on function public.radar_pin_request_status(text) from public;
grant execute on function public.radar_pin_request_status(text) to anon,authenticated;

create function public.radar_admin_update_pin_request(p_id uuid,p_status text,p_reply text default '',p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 if p_status is null or p_status not in ('received','in_analysis','responded') or pg_catalog.char_length(coalesce(p_reply,''))>500 or pg_catalog.char_length(coalesce(p_note,''))>500
 then raise exception 'Situação ou resposta inválida' using errcode='22023'; end if;
 update public.radar_pin_requests set status=p_status,public_reply=coalesce(p_reply,''),admin_note=coalesce(p_note,''),updated_at=now() where id=p_id;
 if not found then raise exception 'Pedido não encontrado' using errcode='22023'; end if;
 insert into public.radar_audit(action,target_id,actor_id) values('pin_request_'||p_status,p_id,(select auth.uid()));
end; $$;
revoke all on function public.radar_admin_update_pin_request(uuid,text,text,text) from public,anon;
grant execute on function public.radar_admin_update_pin_request(uuid,text,text,text) to authenticated;

create function public.radar_admin_dashboard_v6()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 return public.radar_admin_dashboard_v5() || pg_catalog.jsonb_build_object('pin_requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)-'protocol_hash' order by r.created_at desc,r.id) from public.radar_pin_requests r),'[]'::jsonb));
end; $$;
revoke all on function public.radar_admin_dashboard_v6() from public,anon;
grant execute on function public.radar_admin_dashboard_v6() to authenticated;
commit;
