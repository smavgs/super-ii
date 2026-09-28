begin;

create or replace function app.enforce_card_owner_limit()
returns trigger
language plpgsql security definer
set search_path = app, pg_catalog
as $card_limit$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id::text, 0));
  if (
    select count(*)
    from app.cards
    where owner_profile_id = new.owner_profile_id
  ) >= 6 then
    raise exception using errcode = '23514', message = 'card_limit_reached';
  end if;
  return new;
end
$card_limit$;

revoke all on function app.enforce_card_owner_limit() from public;
grant execute on function app.enforce_card_owner_limit() to superii_web_backend;

drop trigger if exists cards_owner_limit_before_insert on app.cards;
create trigger cards_owner_limit_before_insert
before insert on app.cards
for each row execute function app.enforce_card_owner_limit();

comment on function app.enforce_card_owner_limit() is
  'Serializes Card creation per owner and rejects a seventh Card';

commit;
