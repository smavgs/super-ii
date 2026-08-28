/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  readonly CLERK_SECRET_KEY?: string;
  readonly DATABASE_URL?: string;
  readonly CONTACT_HASH_SALT?: string;
  readonly RUNTIME_URL?: string;
  readonly RUNTIME_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
