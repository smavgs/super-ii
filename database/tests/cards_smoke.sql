begin;

insert into app.profiles (id, clerk_user_id, handle, display_name)
values ('00000000-0000-4000-8000-000000000091', 'cards_test_user', 'cards-test', 'Cards Test')
on conflict (clerk_user_id) do update set display_name = excluded.display_name;

insert into app.profiles (id, clerk_user_id, handle, display_name)
values ('00000000-0000-4000-8000-000000000093', 'cards_test_other', 'cards-test-other', 'Other Cards Test')
on conflict (clerk_user_id) do update set display_name = excluded.display_name;

insert into app.card_contact_vaults (profile_id, ciphertext, iv)
values ('00000000-0000-4000-8000-000000000091', repeat('v', 32), 'abcdefghijklmnop')
on conflict (profile_id) do update set ciphertext = excluded.ciphertext;

insert into app.cards (
  id, owner_profile_id, name, preset, status, share_token_hash,
  share_token_ciphertext, share_token_iv, config
) values (
  '00000000-0000-4000-8000-000000000092',
  '00000000-0000-4000-8000-000000000091',
  'Conference', 'conference', 'active', repeat('a', 64),
  repeat('t', 32), 'abcdefghijklmnop', '{}'::jsonb
) on conflict (id) do update set status = 'active', share_token_hash = repeat('a', 64);

insert into app.card_photos (
  id, owner_profile_id, content_hash, mime_type, byte_size, ciphertext, iv
) values (
  '00000000-0000-4000-8000-000000000094',
  '00000000-0000-4000-8000-000000000091',
  repeat('c', 64), 'image/jpeg', 1024, repeat('z', 2048), 'abcdefghijklmnop'
) on conflict (id) do update set ciphertext = excluded.ciphertext;

insert into app.card_public_snapshots (card_id, owner_profile_id, snapshot)
values (
  '00000000-0000-4000-8000-000000000092',
  '00000000-0000-4000-8000-000000000091',
  '{"version":1,"card_id":"00000000-0000-4000-8000-000000000092","name":"Conference","identity_en":{"name":"Cards Test"},"photo_url":"https://superii.site/card-images/00000000-0000-4000-8000-000000000094.jpg","services":[],"verified_badges":[],"personal_badges":[],"allow_share_back":true}'::jsonb
) on conflict (card_id) do update set snapshot = excluded.snapshot;

do $cards$
declare
  resolved record;
  connection_id uuid;
  resolved_photo record;
  mismatched_snapshot_rejected boolean := false;
  mismatched_connection_rejected boolean := false;
  card_limit_rejected boolean := false;
begin
  select * into resolved from app.resolve_public_card(repeat('a', 64));
  if resolved.card_id <> '00000000-0000-4000-8000-000000000092'::uuid then
    raise exception 'active card token did not resolve';
  end if;
  if exists(select 1 from app.resolve_public_card(repeat('b', 64))) then
    raise exception 'unknown card token resolved';
  end if;
  select * into resolved_photo from app.resolve_public_card_photo('00000000-0000-4000-8000-000000000094');
  if resolved_photo.photo_id <> '00000000-0000-4000-8000-000000000094'::uuid then
    raise exception 'active selected card photo did not resolve';
  end if;

  insert into app.cards (
    id, owner_profile_id, name, preset, share_token_hash,
    share_token_ciphertext, share_token_iv, config
  )
  select
    ('00000000-0000-4000-8000-' || lpad((100 + sequence)::text, 12, '0'))::uuid,
    '00000000-0000-4000-8000-000000000091'::uuid,
    'Card ' || sequence, 'custom',
    md5('card-limit-a-' || sequence) || md5('card-limit-b-' || sequence),
    repeat('l', 32), 'abcdefghijklmnop', '{}'::jsonb
  from generate_series(1, 5) as generated(sequence);

  begin
    insert into app.cards (
      id, owner_profile_id, name, preset, share_token_hash,
      share_token_ciphertext, share_token_iv, config
    ) values (
      '00000000-0000-4000-8000-000000000106',
      '00000000-0000-4000-8000-000000000091',
      'Seventh Card', 'custom',
      md5('card-limit-a-6') || md5('card-limit-b-6'),
      repeat('l', 32), 'abcdefghijklmnop', '{}'::jsonb
    );
  exception when check_violation then
    if sqlerrm = 'card_limit_reached' then card_limit_rejected := true;
    else raise;
    end if;
  end;
  if not card_limit_rejected then
    raise exception 'seventh card was accepted';
  end if;

  connection_id := app.submit_card_connection(
    repeat('a', 64), repeat('p', 32), 'abcdefghijklmnop', null, null
  );
  if connection_id is null then raise exception 'card connection was not stored'; end if;
  if (select count(*) from app.card_connections where id = connection_id) <> 1 then
    raise exception 'card connection row missing';
  end if;

  update app.card_public_snapshots
  set snapshot = jsonb_set(snapshot, '{allow_share_back}', 'false'::jsonb)
  where card_id = resolved.card_id;
  if app.submit_card_connection(
    repeat('a', 64), repeat('q', 32), 'abcdefghijklmnop', null, null
  ) is not null then
    raise exception 'share-back disabled card accepted a connection';
  end if;
  update app.card_public_snapshots
  set snapshot = jsonb_set(snapshot, '{allow_share_back}', 'true'::jsonb)
  where card_id = resolved.card_id;

  begin
    update app.card_public_snapshots
    set owner_profile_id = '00000000-0000-4000-8000-000000000093'
    where card_id = resolved.card_id;
  exception when foreign_key_violation then
    mismatched_snapshot_rejected := true;
  end;
  if not mismatched_snapshot_rejected then
    raise exception 'snapshot owner was not bound to card owner';
  end if;

  begin
    insert into app.card_connections (
      owner_profile_id, card_id, payload_ciphertext, payload_iv
    ) values (
      '00000000-0000-4000-8000-000000000093', resolved.card_id,
      repeat('x', 32), 'abcdefghijklmnop'
    );
  exception when foreign_key_violation then
    mismatched_connection_rejected := true;
  end;
  if not mismatched_connection_rejected then
    raise exception 'connection owner was not bound to card owner';
  end if;

  update app.cards set status = 'paused' where id = resolved.card_id;
  if exists(select 1 from app.resolve_public_card(repeat('a', 64))) then
    raise exception 'paused card remained public';
  end if;
  if exists(select 1 from app.resolve_public_card_photo('00000000-0000-4000-8000-000000000094')) then
    raise exception 'paused card photo remained public';
  end if;
end
$cards$;

delete from app.cards where id = '00000000-0000-4000-8000-000000000092';
delete from app.profiles where id = '00000000-0000-4000-8000-000000000091';
delete from app.profiles where id = '00000000-0000-4000-8000-000000000093';

commit;
