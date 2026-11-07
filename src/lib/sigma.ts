import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { SigmaDocument } from "./sigma-input";

export type SigmaStory = {
  id: string;
  slug: string;
  owner: string;
  owner_name: string;
  published_at: string;
  document: SigmaDocument;
};
export type SigmaDraft = {
  id: string;
  slug: string;
  owner: string;
  status: string;
  version: number;
  document: SigmaDocument;
  published_at: string | null;
  updated_at: string;
};
export type SigmaAccess = {
  profile_id: string | null;
  editor: boolean;
  admin: boolean;
};
export type SigmaEngagement = { likes_count: number; liked: boolean };
export type SigmaPage = {
  stories: (SigmaStory & SigmaEngagement)[];
  total: number;
  page: number;
  size: number;
};
export async function sigmaPage(sql: NeonQueryFunction<false, false>, query = "", topic = "", page = 0, size = 3): Promise<SigmaPage> {
  const rows = await sql`select app.sigma_public_page(${query},${topic},${page},${size}) as result`;
  return rows[0].result as SigmaPage;
}
export async function sigmaEngagement(sql: NeonQueryFunction<false, false>, id: string): Promise<SigmaEngagement | null> {
  const rows = await sql`select app.sigma_story_engagement(${id}::uuid) as result`;
  return rows[0].result as SigmaEngagement | null;
}
export async function sigmaAccess(
  sql: NeonQueryFunction<false, false>,
): Promise<SigmaAccess> {
  const rows = await sql`select app.sigma_access() as access`;
  return rows[0].access as SigmaAccess;
}
export async function sigmaStories(
  sql: NeonQueryFunction<false, false>,
  query = "",
  page = 0,
  size = 4,
): Promise<SigmaStory[]> {
  return (await sql`select * from app.sigma_public_stories(${query}, ${page * size}, ${size + 1})`) as SigmaStory[];
}
export async function sigmaStory(
  sql: NeonQueryFunction<false, false>,
  owner: string,
  slug: string,
): Promise<SigmaStory | null> {
  const rows =
    await sql`select * from app.sigma_public_story(${owner}, ${slug})`;
  return (rows[0] as SigmaStory) ?? null;
}
