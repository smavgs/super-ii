begin;

-- Use Model treats repository lineage as executable guidance, so the database
-- owns the complete, reviewed derivation vocabulary rather than accepting
-- arbitrary publisher strings.
alter table app.repository_relationships
  drop constraint if exists repository_relationships_relationship_type_check;

alter table app.repository_relationships
  add constraint repository_relationships_relationship_type_check
  check (relationship_type in (
    'trained-on',
    'fine-tuned-from',
    'quantized-from',
    'converted-from',
    'adapter-for',
    'merged-from',
    'distilled-from',
    'uses-dataset',
    'used-by-app',
    'evaluated-on'
  ));

create or replace function app.is_model_derivation(candidate text)
returns boolean
language plpgsql
immutable
strict
set search_path = app, pg_catalog
as $$
begin
  return candidate in (
    'fine-tuned-from',
    'quantized-from',
    'converted-from',
    'adapter-for',
    'merged-from',
    'distilled-from'
  );
end;
$$;

comment on function app.is_model_derivation(text) is
  'Fail-closed classifier for reviewed model derivation relationship types used by Use Model.';

commit;
