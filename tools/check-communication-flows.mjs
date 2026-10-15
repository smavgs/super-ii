import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { queryDatabase as db } from './lib/connection-test-db.mjs';

// Run the page's real query against disposable records, including hidden owners
// and stale event metadata. Never connect this test to the production database.
const source = await readFile(new URL('../src/pages/feed.astro', import.meta.url), 'utf8');
const query = source.match(/events = await sql`([\s\S]+?)` as FeedEvent\[\]/)?.[1];
assert(query, 'Feed query not found');
const suffix = randomUUID().slice(0, 8);
const owner = randomUUID(), hiddenOwner = randomUUID();
const paper = randomUUID(), hiddenPaper = randomUUID(), post = randomUUID(), hiddenPost = randomUUID();
const repository = randomUUID();
const eventIds = Array.from({ length: 7 }, () => randomUUID());
const ids = (values) => values.map((value) => `'${value}'`).join(',');
try {
  await db(`insert into app.profiles(id, clerk_user_id, handle, display_name, is_public) values
    ('${owner}','comm-${suffix}','comm-${suffix}','Public writer',true),
    ('${hiddenOwner}','hidden-${suffix}','hidden-${suffix}','Hidden writer',false) returning id`, null, true);
  await db(`insert into app.papers(id,owner_profile_id,slug,title,abstract,is_public) values
    ('${paper}','${owner}','paper-${suffix}','Current paper title','A public research abstract.',true),
    ('${hiddenPaper}','${owner}','hidden-${suffix}','Private paper','A private research abstract.',false) returning id`, null, true);
  await db(`insert into app.posts(id,author_profile_id,slug,title,summary,body,is_public) values
    ('${post}','${owner}','post-${suffix}','Current post title','','Public body',true),
    ('${hiddenPost}','${hiddenOwner}','hidden-${suffix}','Hidden author post','','Hidden author body',true) returning id`, null, true);
  await db(`insert into app.repositories(id,kind,owner_handle,slug,title,summary,visibility,status)
    values('${repository}','model','comm-${suffix}','private-model-${suffix}','Private model','','private','draft') returning id`, null, true);
  const events = [
    [eventIds[0], 'paper.published', null, { paper_id: paper, title: 'Stale paper title', slug: 'stale' }],
    [eventIds[1], 'post.published', null, { post_id: post, title: 'Stale post title', slug: 'stale' }],
    [eventIds[2], 'paper.published', null, { paper_id: hiddenPaper, title: 'Private paper' }],
    [eventIds[3], 'post.published', null, { post_id: hiddenPost, title: 'Hidden author post' }],
    [eventIds[4], 'repository.created', repository, {}],
    [eventIds[5], 'paper.published', null, { paper_id: 'malformed-id', title: 'Invalid reference' }],
    [eventIds[6], 'post.published', null, { post_id: randomUUID(), title: 'Removed post' }],
  ];
  for (const [id, type, repo, metadata] of events) await db(`insert into app.activity_events(id,actor_profile_id,event_type,repository_id,metadata)
    values('${id}','${owner}','${type}',${repo ? `'${repo}'` : 'null'},'${JSON.stringify(metadata)}'::jsonb) returning id`, null, true);
  const result = (await db(query)).filter((row) => eventIds.includes(row.id));
  assert.deepEqual(new Set(result.map((row) => row.id)), new Set(eventIds.slice(0, 2)));
  const actualPaper = result.find((row) => row.id === eventIds[0]);
  assert.equal(actualPaper.content_title, 'Current paper title');
  assert.equal(actualPaper.content_slug, `paper-${suffix}`);
  assert.equal(actualPaper.content_owner, `comm-${suffix}`);
  assert.equal(result.find((row) => row.id === eventIds[1]).content_title, 'Current post title');
  console.log('Communications SQL checks passed: current public destinations; private, hidden-owner, removed and invalid targets excluded.');
} finally {
  await db(`delete from app.activity_events where id in (${ids(eventIds)}) returning id`, null, true);
  await db(`delete from app.repositories where id='${repository}' returning id`, null, true);
  await db(`delete from app.papers where id in (${ids([paper, hiddenPaper])}) returning id`, null, true);
  await db(`delete from app.posts where id in (${ids([post, hiddenPost])}) returning id`, null, true);
  await db(`delete from app.profiles where id in (${ids([owner, hiddenOwner])}) returning id`, null, true);
}
