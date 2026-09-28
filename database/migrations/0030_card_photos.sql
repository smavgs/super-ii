begin;

create table if not exists app.card_photos (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.profiles(id) on delete cascade,
  content_hash text not null,
  mime_type text not null,
  byte_size integer not null,
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  constraint card_photos_owner_hash_unique unique (owner_profile_id, content_hash),
  constraint card_photos_content_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint card_photos_mime_type_check check (mime_type = 'image/jpeg'),
  constraint card_photos_byte_size_check check (byte_size between 512 and 240000),
  constraint card_photos_ciphertext_check check (length(ciphertext) between 24 and 524288),
  constraint card_photos_iv_check check (iv ~ '^[A-Za-z0-9_-]{16}$')
);

create index if not exists card_photos_owner_created_idx
  on app.card_photos(owner_profile_id, created_at desc);

alter table app.card_photos enable row level security;

drop policy if exists card_photos_owner_all on app.card_photos;
create policy card_photos_owner_all on app.card_photos
  for all to superii_web_backend
  using (app.context_is_verified() and owner_profile_id = app.current_profile_id())
  with check (app.context_is_verified() and owner_profile_id = app.current_profile_id());

grant select, insert, update, delete on app.card_photos to superii_web_backend;

create or replace function app.resolve_public_card_photo(p_photo_id uuid)
returns table(
  photo_id uuid,
  owner_profile_id uuid,
  ciphertext text,
  iv text,
  mime_type text,
  byte_size integer
)
language sql stable security definer
set search_path = app, pg_catalog
as $public_card_photo$
  select photo.id, photo.owner_profile_id, photo.ciphertext, photo.iv,
         photo.mime_type, photo.byte_size
  from app.card_photos photo
  where photo.id = p_photo_id
    and exists (
      select 1
      from app.cards card
      join app.card_public_snapshots snapshot on snapshot.card_id = card.id
      where card.owner_profile_id = photo.owner_profile_id
        and card.status = 'active'
        and snapshot.snapshot ->> 'photo_url' in (
          'https://superii.site/card-images/' || photo.id::text || '.jpg',
          'https://www.superii.site/card-images/' || photo.id::text || '.jpg'
        )
    )
  limit 1
$public_card_photo$;

revoke all on function app.resolve_public_card_photo(uuid) from public;
grant execute on function app.resolve_public_card_photo(uuid) to superii_web_backend;

comment on table app.card_photos is
  'Small metadata-stripped Card portraits encrypted by the application before storage';
comment on function app.resolve_public_card_photo(uuid) is
  'Returns an encrypted Card portrait only while an active public snapshot selects it';

commit;
