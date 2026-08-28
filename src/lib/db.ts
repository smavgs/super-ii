import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { env } from 'cloudflare:workers';
import * as schema from './schema';

export function runtimeValue(_locals: App.Locals, key: string): string | undefined {
  const value = (env as Record<string, string | undefined>)[key];
  if (value) return value;
  return import.meta.env[key as keyof ImportMetaEnv];
}

export function databaseUrl(locals: App.Locals): string | undefined {
  return runtimeValue(locals, 'DATABASE_URL');
}

export function sqlClient(locals: App.Locals): NeonQueryFunction<false, false> | null {
  const url = databaseUrl(locals);
  return url ? neon(url) : null;
}

export function database(locals: App.Locals): NeonHttpDatabase<typeof schema> | null {
  const sql = sqlClient(locals);
  return sql ? drizzle(sql, { schema }) : null;
}

export async function pingDatabase(locals: App.Locals): Promise<'ok' | 'unconfigured' | 'error'> {
  const sql = sqlClient(locals);
  if (!sql) return 'unconfigured';

  try {
    await Promise.race([
      sql`select 1 as healthy`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ]);
    return 'ok';
  } catch {
    return 'error';
  }
}
