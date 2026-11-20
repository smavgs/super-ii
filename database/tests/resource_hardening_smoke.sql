begin;
do $$
declare result jsonb; candidate jsonb;
begin
  foreach candidate in array array[
    '["https://*.example/callback"]'::jsonb,
    '["https://%2a.example/callback"]'::jsonb,
    '[null]'::jsonb,
    '["https://user:pass@example.com/callback"]'::jsonb
  ] loop
    begin
      perform app.register_agent_oauth_client('invalid test', candidate);
      raise exception 'invalid redirect unexpectedly accepted';
    exception when raise_exception then
      if sqlerrm <> 'invalid_redirect_uri' then raise; end if;
    end;
  end loop;
  result := app.register_agent_oauth_client('literal redirect test',
    '["https://example.com/callback","http://127.0.0.1:8765/callback","http://[::1]:8765/callback"]'::jsonb);
  if jsonb_array_length(result->'redirect_uris') <> 3 then raise exception 'literal redirect changed'; end if;
  -- No live clients are created: the entire test is rolled back.
  update app.request_limits set request_count=600,window_started_at=now()
    where network_hash=repeat('0',64) and action='oauth.register.platform';
  begin
    perform app.register_agent_oauth_client('over capacity test', '[]'::jsonb);
    raise exception 'shared registration allowance bypassed';
  exception when raise_exception then
    if sqlerrm <> 'registration_capacity_reached' then raise; end if;
  end;
end $$;
rollback;
