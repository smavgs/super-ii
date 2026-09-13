import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { AssistantMessage } from './openrouter';
import type { AssistantPlan } from './assistant-plan';
import { assistantPlanEntitlements, assistantStorageLimit } from './assistant-plan';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AssistantThreadSummary = {
  id: string;
  title: string;
  status: 'recent' | 'archived';
  projectLabel: string | null;
  pagePath: string | null;
  messageCount: number;
  preview: string;
  updatedAt: string;
};

export type AssistantThread = AssistantThreadSummary & {
  messages: Array<AssistantMessage & { createdAt: string }>;
};

export type AssistantMemoryItem = {
  id: string;
  label: string;
  content: string;
  sourceThreadId: string | null;
  updatedAt: string;
};

export function parseAssistantId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function threadSummary(row: Record<string, unknown>): AssistantThreadSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status === 'archived' ? 'archived' : 'recent',
    projectLabel: typeof row.project_label === 'string' ? row.project_label : null,
    pagePath: typeof row.page_path === 'string' ? row.page_path : null,
    messageCount: asNumber(row.message_count),
    preview: typeof row.preview === 'string' ? row.preview : '',
    updatedAt: String(row.updated_at),
  };
}

export async function listAssistantThreads(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  status: 'recent' | 'archived' | 'all',
  query: string | null,
  limit = 100,
): Promise<AssistantThreadSummary[]> {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const boundedQuery = query?.trim().slice(0, 200) || null;
  const rows = boundedQuery
    ? await sql`
        select thread.id, thread.title, thread.status, thread.project_label, thread.page_path,
               thread.updated_at, count(message.id)::integer as message_count,
               coalesce((array_agg(left(message.content, 240) order by message.sequence desc))[1], '') as preview
        from app.assistant_threads thread
        left join app.assistant_messages message on message.thread_id = thread.id
        where thread.profile_id = ${profileId}::uuid
          and (${status} = 'all' or thread.status = ${status})
          and (
            to_tsvector('simple', thread.title || ' ' || coalesce(thread.project_label, ''))
              @@ websearch_to_tsquery('simple', ${boundedQuery})
            or exists (
              select 1 from app.assistant_messages searched
              where searched.thread_id = thread.id
                and searched.search_document @@ websearch_to_tsquery('simple', ${boundedQuery})
            )
          )
        group by thread.id
        order by thread.updated_at desc
        limit ${boundedLimit}
      `
    : await sql`
        select thread.id, thread.title, thread.status, thread.project_label, thread.page_path,
               thread.updated_at, count(message.id)::integer as message_count,
               coalesce((array_agg(left(message.content, 240) order by message.sequence desc))[1], '') as preview
        from app.assistant_threads thread
        left join app.assistant_messages message on message.thread_id = thread.id
        where thread.profile_id = ${profileId}::uuid
          and (${status} = 'all' or thread.status = ${status})
        group by thread.id
        order by thread.updated_at desc
        limit ${boundedLimit}
      `;
  return rows.map((row) => threadSummary(row as Record<string, unknown>));
}

export async function getAssistantThread(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  threadId: string,
): Promise<AssistantThread | null> {
  const rows = await sql`
    select thread.id, thread.title, thread.status, thread.project_label, thread.page_path,
           thread.updated_at, count(message.id)::integer as message_count,
           coalesce((array_agg(left(message.content, 240) order by message.sequence desc))[1], '') as preview
    from app.assistant_threads thread
    left join app.assistant_messages message on message.thread_id = thread.id
    where thread.id = ${threadId}::uuid and thread.profile_id = ${profileId}::uuid
    group by thread.id
    limit 1
  `;
  if (!rows[0]) return null;
  const messages = await sql`
    select role, content, created_at
    from (
      select sequence, role, content, created_at
      from app.assistant_messages
      where thread_id = ${threadId}::uuid
      order by sequence desc
      limit 400
    ) recent_messages
    order by sequence
  `;
  return {
    ...threadSummary(rows[0] as Record<string, unknown>),
    messages: messages.flatMap((message) => {
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') return [];
      return [{
        role: message.role,
        content: message.content,
        createdAt: String(message.created_at),
      }];
    }),
  };
}

export async function assistantThreadOwned(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  threadId: string,
): Promise<boolean> {
  const rows = await sql`
    select exists (
      select 1 from app.assistant_threads
      where id = ${threadId}::uuid and profile_id = ${profileId}::uuid
    ) as owned
  `;
  return rows[0]?.owned === true;
}

export async function persistAssistantExchange(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  plan: AssistantPlan,
  threadId: string | null,
  userContent: string,
  assistantContent: string,
  model: string,
  pagePath: string | null,
): Promise<{ threadId: string; storageUsedBytes: number } | null> {
  if (!assistantPlanEntitlements[plan].persistentHistory) return null;
  const rows = await sql`
    select * from app.persist_assistant_exchange(
      ${profileId}::uuid,
      ${threadId}::uuid,
      ${userContent},
      ${assistantContent},
      'openrouter',
      ${model},
      ${pagePath},
      ${assistantStorageLimit(plan)}::bigint
    )
  `;
  const row = rows[0];
  return row?.thread_id ? {
    threadId: String(row.thread_id),
    storageUsedBytes: asNumber(row.storage_used_bytes),
  } : null;
}

export async function updateAssistantThread(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  threadId: string,
  status: 'recent' | 'archived',
  projectLabel: string | null,
): Promise<boolean> {
  const rows = await sql`
    select app.set_assistant_thread_state(
      ${profileId}::uuid,
      ${threadId}::uuid,
      ${status},
      ${projectLabel}
    ) as changed
  `;
  return rows[0]?.changed === true;
}

export async function deleteAssistantThread(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  threadId: string,
): Promise<boolean> {
  const rows = await sql`
    select app.delete_assistant_thread(${profileId}::uuid, ${threadId}::uuid) as deleted
  `;
  return rows[0]?.deleted === true;
}

export async function assistantMemoryState(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
): Promise<{ enabled: boolean; items: AssistantMemoryItem[] }> {
  const preferenceRows = await sql`
    select coalesce((
      select memory_enabled from app.assistant_memory_preferences where profile_id = ${profileId}::uuid
    ), false) as enabled
  `;
  const rows = await sql`
    select id, label, content, source_thread_id, updated_at
    from app.assistant_memory_items
    where profile_id = ${profileId}::uuid
    order by updated_at desc
    limit 100
  `;
  return {
    enabled: preferenceRows[0]?.enabled === true,
    items: rows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      content: String(row.content),
      sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : null,
      updatedAt: String(row.updated_at),
    })),
  };
}

export async function setAssistantMemoryEnabled(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  enabled: boolean,
): Promise<boolean> {
  const rows = await sql`
    select app.set_assistant_memory_enabled(${profileId}::uuid, ${enabled}) as enabled
  `;
  return rows[0]?.enabled === true;
}

export async function addAssistantMemory(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  plan: AssistantPlan,
  label: string,
  content: string,
  sourceThreadId: string | null,
): Promise<string | null> {
  const rows = await sql`
    select app.add_assistant_memory(
      ${profileId}::uuid,
      ${label},
      ${content},
      ${sourceThreadId}::uuid,
      ${assistantStorageLimit(plan)}::bigint
    ) as memory_id
  `;
  return rows[0]?.memory_id ? String(rows[0].memory_id) : null;
}

export async function updateAssistantMemory(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  plan: AssistantPlan,
  memoryId: string,
  label: string,
  content: string,
): Promise<boolean> {
  const rows = await sql`
    select app.update_assistant_memory(
      ${profileId}::uuid,
      ${memoryId}::uuid,
      ${label},
      ${content},
      ${assistantStorageLimit(plan)}::bigint
    ) as updated
  `;
  return rows[0]?.updated === true;
}

export async function deleteAssistantMemory(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
  memoryId: string | null,
): Promise<number> {
  const rows = await sql`
    select app.delete_assistant_memory(${profileId}::uuid, ${memoryId}::uuid) as deleted_count
  `;
  return asNumber(rows[0]?.deleted_count);
}
