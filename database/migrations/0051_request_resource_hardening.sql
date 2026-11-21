begin;

-- Require literal redirect authorities in the database as well as the Worker.
create or replace function app.register_agent_oauth_client(p_name text, p_redirects jsonb)
returns jsonb language plpgsql security definer set search_path = app, pg_catalog as $$
declare result app_private.agent_oauth_clients; uri text;
begin
  if p_name is null or p_redirects is null or char_length(p_name) not between 1 and 120 or jsonb_typeof(p_redirects) <> 'array'
    or jsonb_array_length(p_redirects) > 8 then raise exception 'invalid_client_metadata'; end if;
  for uri in select jsonb_array_elements_text(p_redirects) loop
    if uri is null or char_length(uri) > 2048 or uri !~ '^(https://[^/#@]+|http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?)/'
      or uri ~ '[#\s]' or split_part(uri, '/', 3) ~ '[*%]' then raise exception 'invalid_redirect_uri'; end if;
  end loop;
  -- Shared admission applies to both OAuth route aliases and all callers.
  if not app.consume_request_limit(repeat('0',64), 'oauth.register.platform', 600, 3600) then
    raise exception 'registration_capacity_reached';
  end if;
  insert into app_private.agent_oauth_clients(name, redirect_uris) values (p_name, p_redirects) returning * into result;
  return jsonb_build_object('client_id',result.id,'client_name',result.name,'redirect_uris',result.redirect_uris,
    'client_id_issued_at',extract(epoch from result.created_at)::bigint,'token_endpoint_auth_method','none',
    'grant_types',jsonb_build_array('authorization_code','urn:ietf:params:oauth:grant-type:device_code'),
    'response_types',jsonb_build_array('code'));
end $$;

commit;
