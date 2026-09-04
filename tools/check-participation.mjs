#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const paths = {
  migration: 'database/migrations/0014_participation_recognition.sql',
  smoke: 'database/tests/participation_smoke.sql',
  proposals: 'src/pages/proposals/index.astro',
  proposal: 'src/pages/proposals/[slug].astro',
  fame: 'src/pages/fame.astro',
  highlights: 'src/pages/highlights.astro',
  highlightStrip: 'src/components/HighlightsStrip.astro',
  profile: 'src/pages/people/[handle].astro',
  checkoutApi: 'src/pages/api/participation/checkout.ts',
  checkoutStatusApi: 'src/pages/api/participation/checkout/[orderId].ts',
  humanVoteApi: 'src/pages/api/proposals/[proposalId]/vote.ts',
  agentVoteApi: 'src/pages/api/proposals/[proposalId]/agent-vote.ts',
  eventApi: 'src/pages/api/highlights/events.ts',
  ipn: 'src/pages/api/payments/nowpayments/ipn.ts',
  openapi: 'src/pages/openapi.json.ts',
  header: 'src/components/Header.astro',
  footer: 'src/components/Footer.astro',
  homepage: 'src/pages/index.astro',
  models: 'src/pages/models/index.astro',
  datasets: 'src/pages/datasets/index.astro',
  spaces: 'src/pages/spaces/index.astro',
  terms: 'src/pages/legal/terms.astro',
  privacy: 'src/pages/legal/privacy.astro',
  security: 'src/pages/security.astro',
  docs: 'src/pages/docs.astro',
  css: 'src/styles/global.css',
  routes: 'src/content/site.json',
};

const files = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(root, path), 'utf8')]),
));

const errors = [];
const requireText = (file, text) => {
  if (!files[file].includes(text)) errors.push(paths[file] + ' is missing: ' + text);
};

for (const table of [
  'proposals', 'proposal_status_history', 'proposal_votes', 'proposal_reports',
  'proposal_leader_badges', 'participation_orders', 'fame_slots',
  'highlight_campaigns', 'highlight_events',
]) requireText('migration', 'app.' + table);

for (const boundary of [
  'human_vote_threshold integer not null default 100',
  'agent_vote_threshold integer not null default 1000',
  'proposal_votes_human_unique_idx',
  'proposal_votes_agent_unique_idx',
  'flag_proposal_vote_rings',
  'finalize_proposal_leaderboard',
  'price_amount_cents = 20000',
  'generate_series(1, 200)',
  "duration_days in (1, 30)",
  'case when p_duration_days = 1 then 100 else 1500 end',
  "repository.visibility = 'public' and repository.status = 'published'",
  "revision.status = 'published'",
  'order by campaign.rotation_count, campaign.last_selected_at nulls first',
  'unique (campaign_id, event_type, visitor_hash, event_day)',
]) requireText('migration', boundary);

for (const test of [
  '100 verified human votes did not accept the proposal',
  'Agent vote did not remain a separate non-binding signal',
  'Founding 200 slot ledger is not exactly 001 through 200',
  'Refunded Founding 200 number was not permanently retired',
  'Fair Highlight rotation did not return the active campaign',
  'Highlight metrics leaked into organic repository signals',
]) requireText('smoke', test);

for (const copy of [
  'Human threshold · 100', 'Agent threshold · 1,000', 'Community Leaders',
  'Permanent monthly badges', 'No paid influence', 'finalize_proposal_leaderboard',
  'not biometric proof of personhood',
]) requireText('proposals', copy);
for (const copy of [
  "const stages = ['voting', 'accepted', 'building', 'shipped']", 'Proposal roadmap status',
  'Report a concern',
]) requireText('proposal', copy);

for (const copy of [
  'Exactly 200 · no #201', '$200 USDC on Ethereum, once.',
  'non-transferable and cannot be resold', 'next available number from 001–200',
]) requireText('fame', copy);
for (const copy of [
  'Promoted', '$1 USD in USDC', '$15 USD in USDC',
  'Only reviewed, published, public work is eligible.',
  'Promotions never change search, organic rank, downloads ranking, or trending.',
  'Highlight statistics',
]) requireText('highlights', copy);

for (const file of ['models', 'datasets', 'spaces']) requireText(file, '<HighlightsStrip');
for (const copy of ['Promoted · kept separate from organic ranking', 'data-highlight-campaign']) {
  requireText('highlightStrip', copy);
}

for (const copy of ['FAME ✦', 'Community #', 'Reviewed public work', 'Proposals']) {
  requireText('profile', copy);
}

for (const marker of [
  "['fame', 'highlight']", 'create_fame_checkout', 'create_highlight_checkout',
  'superii:participation:', 'NOWPayments',
]) requireText('checkoutApi', marker);
for (const marker of [
  'apply_participation_payment_status', 'isUsdcEthereumRoute',
  'superii:participation:', 'private, no-store',
]) requireText('checkoutStatusApi', marker);
requireText('humanVoteApi', 'cast_human_proposal_vote');
requireText('humanVoteApi', 'requestNetworkHash');
requireText('agentVoteApi', "authorizeSocialAgent(request, sql, 'social.vote')");
requireText('agentVoteApi', 'cast_agent_proposal_vote');
requireText('eventApi', 'record_highlight_event');
requireText('eventApi', 'requestNetworkHash');
requireText('ipn', 'superii:participation:');
requireText('ipn', 'apply_participation_payment_status');

for (const endpoint of [
  "'/api/proposals'", "'/api/proposals/{proposalId}/vote'",
  "'/api/proposals/{proposalId}/agent-vote'", "'/api/participation/checkout'",
  "'/api/highlights/events'",
]) requireText('openapi', endpoint);

for (const route of ['/proposals', '/fame', '/highlights']) {
  requireText('header', "href: '" + route + "'");
  requireText('footer', 'href="' + route + '"');
  requireText('routes', '"' + route + '"');
}
for (const copy of ['Public roadmap 🗳️', 'The Founding 200 ✦', 'Recognition never buys power.']) {
  requireText('homepage', copy);
}

for (const [file, marker] of [
  ['terms', '<strong>Proposals.</strong>'],
  ['terms', '<strong>Hall of Fame.</strong>'],
  ['terms', '<strong>Highlights.</strong>'],
  ['privacy', '<strong>Proposal information:</strong>'],
  ['security', 'Founding 200 uses a locked 001–200 ledger'],
  ['docs', 'id="proposals"'],
  ['docs', 'id="fame"'],
  ['docs', 'id="highlights"'],
]) requireText(file, marker);

requireText('css', '.leader-list[hidden]');
requireText('css', 'display: none;');

const nonDocumentationSources = [
  files.migration, files.proposals, files.proposal, files.fame, files.highlights,
  files.checkoutApi, files.checkoutStatusApi, files.humanVoteApi, files.agentVoteApi,
  files.eventApi, files.ipn,
].join('\n');
if (/placeholder (founder|holder|proposal|campaign)|fake (vote|founder|holder|campaign)/i.test(nonDocumentationSources)) {
  errors.push('participation implementation must not seed or render fake public activity');
}
if (errors.length) {
  for (const error of errors) console.error('ERROR: ' + error);
  process.exit(1);
}

console.log('OK: Proposals, verified human and agent vote separation, permanent leaders, exact Founding 200 inventory, fixed USDC prices, reviewed-work Highlights, fair rotation, separated metrics, public profiles, legal copy, and API contracts verified');
