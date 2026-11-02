-- Transactional notifications for existing work. No historical backfill.
begin;
alter table app.notifications add column if not exists event_key text;
alter table app.notifications add column if not exists resource_type text;
alter table app.notifications add column if not exists resource_id uuid;
alter table app.notifications add column if not exists needs_action boolean not null default false;
create unique index if not exists notifications_event_key on app.notifications(profile_id,event_key);
create index if not exists notifications_profile_history on app.notifications(profile_id,created_at desc,id desc);
create index if not exists notifications_resource on app.notifications(resource_type,resource_id) where needs_action;

create or replace function app.notification_resource_visible(p_type text,p_id uuid)
returns boolean language sql stable security definer set search_path=app,pg_catalog as $$
 select case when p_type is null then true
 when p_type='repository' then app.can_access_repository(p_id,false)
 when p_type='organization' then app.can_access_organization(p_id,false)
 when p_type='company' then app.can_manage_company(p_id)
 when p_type='workroom' then app.can_access_workroom(p_id)
 when p_type='social' then exists(select 1 from app.social_agents where id=p_id and owner_profile_id=app.current_profile_id())
 else false end
$$;
-- This restrictive policy also protects the older Workspace/assistant queries.
drop policy if exists notifications_resource_guard on app.notifications;
create policy notifications_resource_guard on app.notifications as restrictive for select
 to superii_web_backend using (app.notification_resource_visible(resource_type,resource_id));

create or replace function app.enqueue_member_notification(p_profile uuid,p_key text,p_event text,p_title text,p_body text,p_href text,p_type text default null,p_resource uuid default null,p_action boolean default false)
returns void language sql volatile security definer set search_path=app,pg_catalog as $$
 insert into app.notifications(profile_id,event_key,event_type,title,body,href,resource_type,resource_id,needs_action)
 select p_profile,p_key,p_event,left(p_title,300),left(p_body,4000),p_href,p_type,p_resource,p_action
 where p_profile is not null
 on conflict(profile_id,event_key) do nothing
$$;

create or replace function app.notify_member_work()
returns trigger language plpgsql security definer set search_path=app,pg_catalog as $$
declare recipient uuid; resource uuid; org uuid; actor uuid:=app.current_profile_id();
 r app.repositories; d app.discussions; w app.workrooms; key text; title text; body text; href text; kind text; action boolean:=false;
begin
 if tg_table_name='robot_inquiries' then
   if tg_op='UPDATE' then
     update app.notifications set needs_action=(new.status='new') where event_key='inquiry:'||new.id::text;
     return new;
   end if;
   for recipient in select profile_id from app.organization_members where organization_id=new.organization_id and role in ('owner','admin') loop
     perform app.enqueue_member_notification(recipient,'inquiry:'||new.id,'product.inquiry','New product inquiry',new.product_name||' · Open your company inbox to reply.','/workspace/products/inquiries?organization='||new.organization_id||'&inquiry='||new.id||'#inquiry-'||new.id,'company',new.organization_id,true);
   end loop;
 elsif tg_table_name in ('discussions','discussion_comments') then
   if tg_table_name='discussions' then d:=new; else select * into d from app.discussions where id=new.discussion_id; end if;
   select * into r from app.repositories where id=d.repository_id;
   for recipient in select distinct candidate from (
     select d.author_profile_id candidate union select r.owner_profile_id
     union select author_profile_id from app.discussion_comments where discussion_id=d.id
     union select profile_id from app.organization_members where organization_id=r.owner_organization_id and role in ('owner','admin','maintainer')
   ) targets where candidate is not null and candidate<>new.author_profile_id loop
     perform app.enqueue_member_notification(recipient,tg_table_name||':'||new.id,'discussion.reply',case when tg_table_name='discussions' then 'New repository discussion' else 'New discussion reply' end,d.title,
       '/'||case r.kind::text when 'model' then 'models' when 'dataset' then 'datasets' else 'spaces' end||'/'||r.owner_handle||'/'||r.slug||'?discussion='||d.id||'#discussion-'||d.id,'repository',r.id,false);
   end loop;
 elsif tg_table_name in ('publication_decisions','repository_revisions') then
   if tg_table_name='publication_decisions' then
     if new.outcome<>'blocked' then return new; end if;
     key:='publication:'||new.id;action:=true;title:='Publication checks need attention';
   else
     if new.status is not distinct from old.status or new.status::text<>'published' then return new; end if;
     key:='published:'||new.id;title:='Repository published';
   end if;
   select * into r from app.repositories where id=new.repository_id;
   if not action then update app.notifications set needs_action=false where resource_type='repository' and resource_id=r.id and event_type='repository.publication'; end if;
   for recipient in select r.owner_profile_id union select profile_id from app.organization_members where organization_id=r.owner_organization_id and role in ('owner','admin','maintainer') loop
     perform app.enqueue_member_notification(recipient,key,'repository.publication',title,r.title,'/repositories/'||r.id||'/edit','repository',r.id,action);
   end loop;
 elsif tg_table_name='workrooms' then
   if new.version=old.version or (new.status='active' and old.status='active') then return new; end if;
   action:=new.status in ('review','blocked');
   update app.notifications set needs_action=false where resource_type='workroom' and resource_id=new.id;
   for recipient in select new.owner_profile_id where new.organization_id is null
      union select profile_id from app.workroom_collaborators where workroom_id=new.id and new.organization_id is null
      union select profile_id from app.organization_members where organization_id=new.organization_id loop
     -- An agent report is actionable for its human issuer too.
     if recipient is distinct from actor or app.current_actor_kind() is distinct from 'clerk' then
       perform app.enqueue_member_notification(recipient,'workroom:'||new.id||':'||new.version,'workroom.'||new.status,
         case new.status when 'review' then 'A result is ready to review' when 'blocked' then 'A workroom needs your help' when 'complete' then 'Workroom completed' when 'archived' then 'Workroom archived' else 'Workroom resumed' end,
         new.document->>'title','/workspace/workrooms/'||new.id,'workroom',new.id,action);
     end if;
   end loop;
 elsif tg_table_name='workroom_collaborators' then
   if tg_op='UPDATE' and new.role=old.role then return new; end if;
   select * into w from app.workrooms where id=new.workroom_id;
   perform app.enqueue_member_notification(new.profile_id,'workroom-access:'||new.workroom_id||':'||new.profile_id||':'||new.role||':'||txid_current(),'workroom.shared','You have workroom access',w.document->>'title','/workspace/workrooms/'||w.id,'workroom',w.id,false);
 elsif tg_table_name='organization_members' then
   if tg_op='UPDATE' and new.role=old.role then return new; end if;
   if new.profile_id is distinct from actor then
     perform app.enqueue_member_notification(new.profile_id,'organization-access:'||new.organization_id||':'||new.profile_id||':'||txid_current(),'organization.membership','Your organization access changed','Your role is now '||new.role||'.','/account#identity','organization',new.organization_id,false);
   end if;
 elsif tg_table_name='card_connections' then
   perform app.enqueue_member_notification(new.owner_profile_id,'card-connection:'||new.id,'card.connection','Someone connected through your Card','Open your private contacts to see their shared details.','/account#cards');
 elsif tg_table_name='bridge_import_jobs' then
   if new.status is not distinct from old.status or new.status not in ('review','complete','failed','cancelled') then return new; end if;
   update app.notifications set needs_action=false where profile_id=new.profile_id and event_key like 'bridge:'||new.id||':%';
   perform app.enqueue_member_notification(new.profile_id,'bridge:'||new.id||':'||new.status||':'||new.retry_count,'bridge.'||new.status,
     case new.status when 'review' then 'Imported work is ready to review' when 'complete' then 'Your import is complete' when 'failed' then 'Your import needs attention' else 'Import cancelled' end,
     'Open Bring my work for the import details.','/bring-my-work?job='||new.id,null,null,new.status in ('review','failed'));
 elsif tg_table_name='agent_contribution_jobs' then
   if new.status is not distinct from old.status then return new; end if;
   update app.notifications set needs_action=false where event_key like 'agent-job:'||new.id||':%';
   perform app.enqueue_member_notification(new.created_by_profile_id,'agent-job:'||new.id||':'||new.status||':'||txid_current(),'agent.job.'||new.status,'Agent job: '||new.status,new.title,'/account#agents',case when new.organization_id is not null then 'organization' end,new.organization_id,new.status='submitted');
 elsif tg_table_name='social_events' then
   if new.event_type not in ('reply_received','mention_received') then return new; end if;
   select owner_profile_id into recipient from app.social_agents where id=new.recipient_agent_id;
   perform app.enqueue_member_notification(recipient,'social:'||new.id,'social.'||new.event_type,'Your agent has a new '||case when new.event_type='reply_received' then 'reply' else 'mention' end,
     'Open the Social web conversation.','/social?post='||coalesce(new.post_id::text,''),'social',new.recipient_agent_id,false);
 elsif tg_table_name='robot_claim_requests' then
   if tg_op='INSERT' then
     if new.organization_id is not null then
       for recipient in select profile_id from app.organization_members where organization_id=new.organization_id and role in ('owner','admin') and profile_id<>new.requester_id loop
         perform app.enqueue_member_notification(recipient,'claim-review:'||new.id,'company.access_request','A company access request needs review','Open the claim workspace to review the request.','/workspace/robots/companies/'||new.reference_company_id,'company',new.organization_id,true);
       end loop;
     end if;
   elsif new.status is distinct from old.status then
     update app.notifications set needs_action=false where event_key='claim-review:'||new.id;
     perform app.enqueue_member_notification(new.requester_id,'claim:'||new.id||':'||new.status,'company.claim.'||new.status,'Company claim: '||new.status,'Open your claim workspace for the decision.','/workspace/robots/companies/'||new.reference_company_id);
   end if;
 elsif tg_table_name in ('agent_access_tokens','social_credentials') then
   if tg_table_name='agent_access_tokens' then recipient:=new.created_by_profile_id; else recipient:=new.owner_profile_id; end if;
   if tg_op='INSERT' then title:='Agent access issued';key:='issued';
   elsif new.revoked_at is distinct from old.revoked_at and new.revoked_at is not null then title:='Agent access revoked';key:='revoked';
   else return new; end if;
   perform app.enqueue_member_notification(recipient,tg_table_name||':'||new.id||':'||key,'account.agent_access',title,'Review your agent access in Workspace.','/account#agents');
 end if;
 return new;
end $$;

do $$ declare tab text; events text; begin
 foreach tab in array array['robot_inquiries','discussions','discussion_comments','publication_decisions','repository_revisions','workrooms','workroom_collaborators','organization_members','card_connections','bridge_import_jobs','agent_contribution_jobs','social_events','robot_claim_requests','agent_access_tokens','social_credentials'] loop
   events:=case when tab in ('discussions','discussion_comments','publication_decisions','card_connections','social_events') then 'insert'
     when tab in ('repository_revisions','workrooms','bridge_import_jobs','agent_contribution_jobs') then 'update' else 'insert or update' end;
   execute format('drop trigger if exists member_work_notification on app.%I',tab);
   execute format('create trigger member_work_notification after %s on app.%I for each row execute function app.notify_member_work()',events,tab);
 end loop;
end $$;
revoke all on function app.enqueue_member_notification(uuid,text,text,text,text,text,text,uuid,boolean),app.notify_member_work(),app.notification_resource_visible(text,uuid)
 from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;
grant execute on function app.notification_resource_visible(text,uuid) to superii_web_backend;
create or replace function app.robot_inquiry_offset(p_org uuid,p_id uuid)
returns integer language plpgsql stable security definer set search_path=app,pg_catalog as $$
declare target app.robot_inquiries; result integer;
begin
 if not app.can_manage_company(p_org) then raise exception 'company_permission_denied' using errcode='42501'; end if;
 select * into target from app.robot_inquiries where id=p_id and organization_id=p_org;
 if target.id is null then return 0; end if;
 select (count(*)/30)*30 into result from app.robot_inquiries where organization_id=p_org and (created_at,id)>(target.created_at,target.id);
 return least(result,9990);
end $$;
revoke all on function app.robot_inquiry_offset(uuid,uuid) from public,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;
grant execute on function app.robot_inquiry_offset(uuid,uuid) to superii_web_backend;
commit;
