/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  readonly CLERK_SECRET_KEY?: string;
  readonly DATABASE_URL?: string;
  readonly DATABASE_CONTEXT_KEY_ID?: string;
  readonly DATABASE_CONTEXT_SECRET?: string;
  readonly DATABASE_PAYMENT_URL?: string;
  readonly DATABASE_PAYMENT_CONTEXT_KEY_ID?: string;
  readonly DATABASE_PAYMENT_CONTEXT_SECRET?: string;
  readonly DATABASE_PUBLISHING_URL?: string;
  readonly DATABASE_PUBLISHING_CONTEXT_KEY_ID?: string;
  readonly DATABASE_PUBLISHING_CONTEXT_SECRET?: string;
  readonly CONTACT_HASH_SALT?: string;
  readonly RUNTIME_URL?: string;
  readonly RUNTIME_TOKEN?: string;
  readonly NOWPAYMENTS_API_KEY?: string;
  readonly NOWPAYMENTS_IPN_SECRET?: string;
  readonly SUPERII_ADMIN_USER_IDS?: string;
  readonly BRIDGE_TOKEN_ENCRYPTION_KEY?: string;
  readonly OPENROUTER_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    locale?: 'en' | 'ru';
    localizedRewrite?: URL;
  }
}
