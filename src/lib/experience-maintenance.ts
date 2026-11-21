import { sqlClient } from './db';

export async function pruneExperience(): Promise<void> {
  const sql = sqlClient({} as App.Locals);
  if (sql) await sql`select app.prune_experience_events()`;
}
