begin;

alter table app.publication_decisions
  drop constraint if exists publication_decisions_policy_version_check;
alter table app.publication_decisions
  add constraint publication_decisions_policy_version_check
  check (policy_version in ('superii-auto-publish-v1', 'superii-auto-publish-v2'));

comment on constraint publication_decisions_policy_version_check
  on app.publication_decisions is
  'Historical v1 decisions remain valid; v2 additionally requires a completed tokenizer analysis for every model.';

commit;
