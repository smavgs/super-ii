import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const app = pgSchema('app');

export const repositoryKind = pgEnum('repository_kind', [
  'model',
  'dataset',
  'space',
]);
export const repositoryVisibility = pgEnum('repository_visibility', [
  'public',
  'private',
  'gated',
]);
export const repositoryStatus = pgEnum('repository_status', [
  'draft',
  'review',
  'published',
  'archived',
]);
export const planStatus = pgEnum('plan_status', [
  'available',
  'beta_waitlist',
  'proposal',
]);
export const repositoryRevisionStatus = pgEnum('repository_revision_status', [
  'draft',
  'quarantined',
  'scanning',
  'review',
  'published',
  'rejected',
]);
export const repositoryReviewDecision = pgEnum('repository_review_decision', [
  'pending',
  'approved',
  'changes_requested',
  'rejected',
]);

export const profiles = app.table(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    avatarUrl: text('avatar_url'),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('profiles_handle_lower_idx').on(table.handle)],
);

export const organizations = app.table(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkOrganizationId: text('clerk_organization_id').unique(),
    handle: text('handle').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('organizations_handle_lower_idx').on(table.handle)],
);

export const organizationMembers = app.table(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.profileId] })],
);

export const plans = app.table('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: planStatus('status').notNull(),
  monthlyPriceCents: integer('monthly_price_cents'),
  billingUnit: text('billing_unit').notNull(),
  features: jsonb('features').$type<string[]>().notNull(),
  isPublic: boolean('is_public').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = app.table(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkUserId: text('clerk_user_id'),
    clerkOrganizationId: text('clerk_organization_id'),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    provider: text('provider').notNull().default('clerk_billing'),
    providerSubscriptionId: text('provider_subscription_id').unique(),
    status: text('status').notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('subscriptions_clerk_user_idx').on(table.clerkUserId)],
);

export const repositories = app.table(
  'repositories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: repositoryKind('kind').notNull(),
    ownerHandle: text('owner_handle').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    license: text('license'),
    task: text('task'),
    library: text('library'),
    modality: text('modality'),
    totalSizeBytes: bigint('total_size_bytes', { mode: 'bigint' }).notNull().default(0n),
    latestRevisionId: uuid('latest_revision_id'),
    visibility: repositoryVisibility('visibility').notNull().default('public'),
    status: repositoryStatus('status').notNull().default('draft'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repositories_owner_slug_idx').on(table.ownerHandle, table.slug),
    index('repositories_public_catalog_idx').on(table.kind, table.visibility, table.status),
  ],
);

export const repositoryRevisions = app.table(
  'repository_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    parentRevisionId: uuid('parent_revision_id'),
    message: text('message').notNull().default(''),
    status: repositoryRevisionStatus('status').notNull().default('draft'),
    manifestSha256: text('manifest_sha256'),
    fileCount: integer('file_count').notNull().default(0),
    totalSizeBytes: bigint('total_size_bytes', { mode: 'bigint' }).notNull().default(0n),
    createdBy: text('created_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repository_revisions_repository_sequence_idx').on(
      table.repositoryId,
      table.sequence,
    ),
    index('repository_revisions_repository_created_idx').on(
      table.repositoryId,
      table.createdAt,
    ),
  ],
);

export const repositoryFiles = app.table(
  'repository_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => repositoryRevisions.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    mimeType: text('mime_type').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    storageState: text('storage_state').notNull().default('quarantine'),
    scanStatus: text('scan_status').notNull().default('pending'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repository_files_revision_path_idx').on(table.revisionId, table.path),
    index('repository_files_sha256_idx').on(table.sha256),
  ],
);

export const repositoryFileInspections = app.table(
  'repository_file_inspections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryFileId: uuid('repository_file_id')
      .notNull()
      .references(() => repositoryFiles.id, { onDelete: 'cascade' }),
    inspector: text('inspector').notNull(),
    status: text('status').notNull(),
    toolVersion: text('tool_version'),
    result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('repository_file_inspections_file_idx').on(
      table.repositoryFileId,
      table.inspector,
      table.startedAt,
    ),
  ],
);

export const repositoryReleases = app.table(
  'repository_releases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => repositoryRevisions.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    notes: text('notes').notNull().default(''),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repository_releases_repository_slug_idx').on(table.repositoryId, table.slug)],
);

export const repositoryTags = app.table(
  'repository_tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => repositoryRevisions.id),
    name: text('name').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repository_tags_repository_name_idx').on(table.repositoryId, table.name)],
);

export const repositoryDownloads = app.table(
  'repository_downloads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').references(() => repositoryRevisions.id),
    repositoryFileId: uuid('repository_file_id').references(() => repositoryFiles.id, {
      onDelete: 'set null',
    }),
    downloaderProfileId: uuid('downloader_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    networkHash: text('network_hash'),
    userAgent: text('user_agent'),
    bytesSent: bigint('bytes_sent', { mode: 'bigint' }).notNull().default(0n),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('repository_downloads_repository_created_idx').on(table.repositoryId, table.createdAt)],
);

export const repositoryReviews = app.table(
  'repository_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => repositoryRevisions.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id').notNull(),
    decision: repositoryReviewDecision('decision').notNull().default('pending'),
    notes: text('notes').notNull().default(''),
    securitySummary: jsonb('security_summary')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repository_reviews_revision_reviewer_idx').on(table.revisionId, table.reviewerId)],
);

export const repositoryRevisionAnalyses = app.table(
  'repository_revision_analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => repositoryRevisions.id, { onDelete: 'cascade' }),
    analysisType: text('analysis_type').notNull(),
    status: text('status').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
    toolVersions: jsonb('tool_versions').$type<Record<string, string>>().notNull().default({}),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repository_revision_analyses_type_idx').on(table.revisionId, table.analysisType)],
);

export const discussions = app.table(
  'discussions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    authorProfileId: uuid('author_profile_id')
      .notNull()
      .references(() => profiles.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('discussions_repository_updated_idx').on(table.repositoryId, table.updatedAt)],
);

export const discussionComments = app.table(
  'discussion_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    discussionId: uuid('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    authorProfileId: uuid('author_profile_id')
      .notNull()
      .references(() => profiles.id),
    parentCommentId: uuid('parent_comment_id'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('discussion_comments_discussion_created_idx').on(table.discussionId, table.createdAt)],
);

export const reactions = app.table(
  'reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reaction: text('reaction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reactions_profile_target_idx').on(
      table.profileId,
      table.targetType,
      table.targetId,
      table.reaction,
    ),
  ],
);

export const discussionEvents = app.table(
  'discussion_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    discussionId: uuid('discussion_id')
      .notNull()
      .references(() => discussions.id, { onDelete: 'cascade' }),
    actorProfileId: uuid('actor_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('discussion_events_discussion_created_idx').on(table.discussionId, table.createdAt)],
);

export const likes = app.table(
  'likes',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.repositoryId] })],
);

export const follows = app.table(
  'follows',
  {
    followerProfileId: uuid('follower_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    followedProfileId: uuid('followed_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.followerProfileId, table.followedProfileId] })],
);

export const repositoryWatchers = app.table(
  'repository_watchers',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    level: text('level').notNull().default('releases'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.repositoryId] })],
);

export const activityEvents = app.table(
  'activity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorProfileId: uuid('actor_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'cascade',
    }),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    isPublic: boolean('is_public').notNull().default(true),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('activity_events_repository_created_idx').on(table.repositoryId, table.occurredAt)],
);

export const collections = app.table(
  'collections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerProfileId: uuid('owner_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    visibility: repositoryVisibility('visibility').notNull().default('public'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('collections_owner_slug_idx').on(table.ownerProfileId, table.slug)],
);

export const collectionItems = app.table(
  'collection_items',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    note: text('note').notNull().default(''),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.collectionId, table.repositoryId] })],
);

export const repositoryRelationships = app.table(
  'repository_relationships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceRepositoryId: uuid('source_repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    targetRepositoryId: uuid('target_repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    relationshipType: text('relationship_type').notNull(),
    sourceRevisionId: uuid('source_revision_id').references(() => repositoryRevisions.id, {
      onDelete: 'set null',
    }),
    targetRevisionId: uuid('target_revision_id').references(() => repositoryRevisions.id, {
      onDelete: 'set null',
    }),
    evidenceUrl: text('evidence_url'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repository_relationships_unique_idx').on(
      table.sourceRepositoryId,
      table.targetRepositoryId,
      table.relationshipType,
    ),
  ],
);

export const requestLimits = app.table(
  'request_limits',
  {
    networkHash: text('network_hash').notNull(),
    action: text('action').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    requestCount: integer('request_count').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.networkHash, table.action] })],
);

export const waitlist = app.table(
  'waitlist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    interest: text('interest').notNull(),
    source: text('source').notNull().default('website'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('waitlist_email_interest_idx').on(table.email, table.interest)],
);

export const contactSubmissions = app.table(
  'contact_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    interest: text('interest').notNull(),
    message: text('message').notNull(),
    networkHash: text('network_hash').notNull(),
    userAgent: text('user_agent'),
    status: text('status').notNull().default('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_submissions_created_idx').on(table.createdAt),
    index('contact_submissions_network_idx').on(table.networkHash, table.createdAt),
  ],
);

export const auditEvents = app.table(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_events_target_idx').on(table.targetType, table.targetId)],
);
