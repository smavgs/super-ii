\set ON_ERROR_STOP on
-- Disposable integration database only; uses the same synthetic context key as
-- test-postgres.sh, never a production credential.
create temp table welcome_test_context(dummy integer);
create function pg_temp.welcome_context(p_user text, p_admin boolean default false)
returns void language sql as $$
 select app.begin_request_context('web','test-web-v1',case when p_user is null then 'public' else 'clerk' end,p_user,null,null,null,null,null,p_admin,c.expires,c.nonce,
  encode(public.hmac(array_to_string(array['superii-db-context-v1','web','test-web-v1',case when p_user is null then 'public' else 'clerk' end,coalesce(p_user,''),'','','','','',case when p_admin then '1' else '0' end,c.expires::text,c.nonce::text],E'\n'),'test-web-context-secret-0123456789abcdef','sha256'),'hex'))
 from (select extract(epoch from clock_timestamp()+interval '30 seconds')::bigint expires,gen_random_uuid() nonce) c
$$;

begin;
select pg_temp.welcome_context('welcome_test_a');
select app.ensure_profile('welcome_test_a','welcome-shared-name','Welcome A',null) as id \gset
update app.profiles set is_public=false where id=:'id';
do $$ declare first_id uuid; begin
 select id into first_id from app.profiles where clerk_user_id='welcome_test_a';
 if app.ensure_profile('welcome_test_a','different-name','Welcome A',null) <> first_id
  or (select handle from app.profiles where id=first_id) <> 'welcome-shared-name' then raise exception 'existing handle changed'; end if;
end $$;
commit;

begin;
select pg_temp.welcome_context('welcome_test_b');
do $$ declare new_id uuid; denied boolean:=false; begin
 if app.profile_handle_available('welcome-shared-name') then raise exception 'private handle incorrectly available'; end if;
 if not app.profile_handle_available('welcome-free-name') then raise exception 'free handle unavailable'; end if;
 if app.profile_handle_available('admin') or app.profile_handle_available('-invalid') or app.profile_handle_available(repeat('a',31)) then raise exception 'invalid/reserved handle allowed'; end if;
 new_id:=app.ensure_profile('welcome_test_b','welcome-shared-name','Welcome B',null);
 if (select handle from app.profiles where id=new_id) not like 'welcome-shared-name-%' then raise exception 'collision fallback failed'; end if;
 if exists(select 1 from app.profiles where clerk_user_id='welcome_test_a') then raise exception 'private identity leaked'; end if;
 begin perform app.ensure_profile('welcome_test_a','hijack','Hijack',null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'cross-user allocation not refused'; end if;
end $$;
commit;

begin;
select pg_temp.welcome_context(null);
select app.record_experience_event('handle_check','home','en');
select app.record_experience_event('handle_check','home','en');
do $$ declare denied boolean:=false; invalid boolean:=false; begin
 begin perform app.experience_report(); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'anonymous report allowed'; end if;
 begin perform app.record_experience_event('private-text','home','en'); exception when check_violation then invalid:=true; end;
 if not invalid then raise exception 'arbitrary event accepted'; end if;
 invalid:=false;
 begin perform app.record_experience_event('handle_check','workspace','en'); exception when invalid_parameter_value then invalid:=true; end;
 if not invalid then raise exception 'invalid event/surface accepted'; end if;
 denied:=false;
 begin perform 1 from app_private.experience_daily; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'raw counter table accessible'; end if;
end $$;
commit;

begin;
select pg_temp.welcome_context('welcome_test_admin',true);
do $$ begin
 if (select total from app.experience_report() where event='handle_check' and surface='home' and locale='en' and day=(now() at time zone 'UTC')::date) <> 2 then raise exception 'aggregate count wrong'; end if;
end $$;
commit;

begin;
do $$ declare denied boolean:=false; begin
 begin perform app.record_experience_event('handle_check','home','en'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'unsigned database context allowed'; end if;
end $$;
rollback;
\echo Welcome restricted-role checks passed
