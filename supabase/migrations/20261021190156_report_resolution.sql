begin;
alter table public.radar_reports add column resolution_status text not null default 'open' check(resolution_status in ('open','resolved')), add column resolution_note text not null default '' check(char_length(resolution_note)<=300), add column resolved_at timestamptz;
create table public.radar_report_resolutions (
 id uuid primary key default extensions.gen_random_uuid(),report_id uuid not null references public.radar_reports(id) on delete cascade,
 status text not null check(status in ('open','resolved')),note text not null check(char_length(note) between 5 and 300),
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create index radar_report_resolutions_report_idx on public.radar_report_resolutions(report_id,created_at,id);
alter table public.radar_report_resolutions enable row level security;
revoke all on public.radar_report_resolutions from public,anon,authenticated;

create function public.radar_admin_resolve_report(p_id uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.radar_reports%rowtype;v_note text:=pg_catalog.btrim(coalesce(p_note,''));
begin
 if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 if p_status is null or p_status not in ('open','resolved') or pg_catalog.char_length(v_note) not between 5 and 300 then raise exception 'Informe a situação e uma explicação pública de 5 a 300 caracteres' using errcode='22023'; end if;
 select * into r from public.radar_reports where id=p_id and status='published' for update;
 if not found then raise exception 'Relato publicado não encontrado' using errcode='22023'; end if;
 if r.resolution_status=p_status and r.resolution_note=v_note then return; end if;
 update public.radar_reports set resolution_status=p_status,resolution_note=v_note,resolved_at=case when p_status='resolved' then now() else null end where id=r.id;
 insert into public.radar_report_resolutions(report_id,status,note,actor_id) values(r.id,p_status,v_note,(select auth.uid()));
 insert into public.radar_audit(action,target_id,actor_id) values(case when p_status='resolved' then 'report_resolved' else 'report_reopened' end,r.id,(select auth.uid()));
end; $$;
revoke all on function public.radar_admin_resolve_report(uuid,text,text) from public,anon;
grant execute on function public.radar_admin_resolve_report(uuid,text,text) to authenticated;

-- Extend the published-only APIs without changing their authorization boundary.
do $patch$
declare definition text;
begin
 definition:=pg_catalog.pg_get_functiondef('public.radar_report_detail(uuid)'::regprocedure);
 if pg_catalog.strpos(definition,'''category'',r.category')=0 then raise exception 'Unknown detail contract'; end if;
 definition:=pg_catalog.replace(definition,'''category'',r.category','''resolution_status'',r.resolution_status,''resolution_note'',r.resolution_note,''resolved_at'',r.resolved_at,''resolution_history'',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(''status'',h.status,''note'',h.note,''created_at'',h.created_at) order by h.created_at,h.id) from public.radar_report_resolutions h where h.report_id=r.id),''[]''::jsonb),''category'',r.category');
 execute definition;
 definition:=pg_catalog.pg_get_functiondef('public.radar_public_groups(text,integer,integer)'::regprocedure);
 if pg_catalog.strpos(definition,'r.reason,r.category,r.event_date,r.created_at')=0 then raise exception 'Unknown grouping contract'; end if;
 execute pg_catalog.replace(definition,'r.reason,r.category,r.event_date,r.created_at','r.reason,r.category,r.event_date,r.resolution_status,r.resolution_note,r.resolved_at,r.created_at');
end $patch$;

create function public.radar_admin_dashboard_v7()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.radar_is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 result:=public.radar_admin_dashboard_v6();
 return result || pg_catalog.jsonb_build_object('reports',coalesce((select pg_catalog.jsonb_agg(item || pg_catalog.jsonb_build_object('resolution_status',r.resolution_status,'resolution_note',r.resolution_note,'resolved_at',r.resolved_at)) from pg_catalog.jsonb_array_elements(result->'reports') item join public.radar_reports r on r.id=(item->>'id')::uuid),'[]'::jsonb));
end; $$;
revoke all on function public.radar_admin_dashboard_v7() from public,anon;
grant execute on function public.radar_admin_dashboard_v7() to authenticated;
commit;
