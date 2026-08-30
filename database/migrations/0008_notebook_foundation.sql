begin;

alter table app.repository_revision_analyses
  drop constraint if exists repository_revision_analyses_analysis_type_check;

alter table app.repository_revision_analyses
  add constraint repository_revision_analyses_analysis_type_check
  check (analysis_type in (
    'model', 'dataset', 'space', 'safetensors', 'tokenizer', 'gguf', 'diffusers', 'notebook'
  ));

comment on constraint repository_revision_analyses_analysis_type_check
  on app.repository_revision_analyses is
  'Only explicit offline analysis contracts are allowed; notebook means static validation without code execution.';

commit;
