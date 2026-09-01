import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
    fullName: text('full_name'),
    description: text('description'),
    organizationType: text('organization_type').notNull().default('community'),
    homepageUrl: text('homepage_url'),
    logoUrl: text('logo_url'),
    githubUsername: text('github_username'),
    twitterUsername: text('twitter_username'),
    linkedinUrl: text('linkedin_url'),
    aiMlInterests: jsonb('ai_ml_interests').$type<string[]>().notNull().default([]),
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
    organizationId: uuid('organization_id').references(() => organizations.id),
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
  (table) => [
    index('subscriptions_clerk_user_idx').on(table.clerkUserId),
    index('subscriptions_organization_idx').on(table.organizationId),
  ],
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
    ownerProfileId: uuid('owner_profile_id').references(() => profiles.id),
    ownerOrganizationId: uuid('owner_organization_id').references(() => organizations.id),
    defaultBranch: text('default_branch').notNull().default('main'),
    cardMarkdown: text('card_markdown').notNull().default(''),
    provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull().default({}),
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
    branchId: uuid('branch_id'),
    message: text('message').notNull().default(''),
    commitSha: text('commit_sha'),
    status: repositoryRevisionStatus('status').notNull().default('draft'),
    manifestSha256: text('manifest_sha256'),
    manifest: jsonb('manifest').$type<Array<Record<string, unknown>>>().notNull().default([]),
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
    integrityState: text('integrity_state').notNull().default('unverified'),
    integrityVerifiedAt: timestamp('integrity_verified_at', { withTimezone: true }),
    integrityReceipt: jsonb('integrity_receipt').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repository_files_revision_path_idx').on(table.revisionId, table.path),
    index('repository_files_sha256_idx').on(table.sha256),
  ],
);

export const repositoryBranches = app.table(
  'repository_branches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    headRevisionId: uuid('head_revision_id').references(() => repositoryRevisions.id, {
      onDelete: 'set null',
    }),
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repository_branches_repository_name_idx').on(table.repositoryId, table.name)],
);

export const repositoryUploads = app.table(
  'repository_uploads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => repositoryRevisions.id, { onDelete: 'cascade' }),
    uploaderProfileId: uuid('uploader_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    filename: text('filename'),
    createdBy: text('created_by'),
    mimeType: text('mime_type').notNull(),
    expectedSizeBytes: bigint('expected_size_bytes', { mode: 'bigint' }).notNull(),
    expectedSha256: text('expected_sha256').notNull(),
    storageBackend: text('storage_backend').notNull().default('r2'),
    storageKey: text('storage_key').notNull(),
    providerUploadId: text('provider_upload_id'),
    uploadedParts: jsonb('uploaded_parts').$type<Array<{ partNumber: number; etag: string }>>().notNull().default([]),
    protocol: text('protocol').notNull().default('tus-1.0.0'),
    offsetBytes: bigint('offset_bytes', { mode: 'bigint' }).notNull().default(0n),
    chunkSizeBytes: integer('chunk_size_bytes').notNull().default(33_554_432),
    capabilityHash: text('capability_hash'),
    actualSha256: text('actual_sha256'),
    repositoryFileId: uuid('repository_file_id').references(() => repositoryFiles.id, {
      onDelete: 'set null',
    }),
    receipt: jsonb('receipt').$type<Record<string, unknown>>().notNull().default({}),
    state: text('state').notNull().default('initiated'),
    errorCode: text('error_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('repository_uploads_activity_idx').on(table.state, table.lastActivityAt)],
);

export const casIntegrityEvents = app.table(
  'cas_integrity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sha256: text('sha256').notNull(),
    eventType: text('event_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }),
    receipt: jsonb('receipt').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('cas_integrity_events_sha_idx').on(table.sha256, table.occurredAt)],
);

export const runtimeModelInstances = app.table(
  'runtime_model_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').notNull().references(() => repositoryRevisions.id, { onDelete: 'cascade' }),
    modelPath: text('model_path').notNull(),
    modelSha256: text('model_sha256').notNull(),
    runtime: text('runtime').notNull().default('llama.cpp'),
    status: text('status').notNull().default('starting'),
    endpointId: text('endpoint_id'),
    coldStartMs: integer('cold_start_ms'),
    requestCount: bigint('request_count', { mode: 'bigint' }).notNull().default(0n),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    runtimeMetadata: jsonb('runtime_metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runtime_model_instances_revision_path_idx').on(table.revisionId, table.modelPath),
    index('runtime_model_instances_status_idx').on(table.status, table.lastUsedAt),
  ],
);

export const runtimeBenchmarkRecords = app.table(
  'runtime_benchmark_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    category: text('category').notNull(),
    repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
    revisionId: uuid('revision_id').references(() => repositoryRevisions.id, { onDelete: 'set null' }),
    runtime: text('runtime').notNull(),
    runtimeVersion: text('runtime_version'),
    modelSha256: text('model_sha256'),
    hardware: jsonb('hardware').$type<Record<string, unknown>>().notNull(),
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull(),
    provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull(),
    claimScope: text('claim_scope').notNull().default('local measurement only'),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('runtime_benchmark_records_category_idx').on(table.category, table.measuredAt)],
);

export const notebookExecutionSessions = app.table(
  'notebook_execution_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').notNull().references(() => repositoryRevisions.id, { onDelete: 'cascade' }),
    notebookPath: text('notebook_path').notNull(),
    profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    containerName: text('container_name').unique(),
    imageDigest: text('image_digest'),
    cpuLimit: numeric('cpu_limit').notNull(),
    memoryLimitBytes: bigint('memory_limit_bytes', { mode: 'bigint' }).notNull(),
    pidsLimit: integer('pids_limit').notNull(),
    networkDisabled: boolean('network_disabled').notNull().default(true),
    secretsInjected: boolean('secrets_injected').notNull().default(false),
    timeoutSeconds: integer('timeout_seconds').notNull(),
    resultSha256: text('result_sha256'),
    exitCode: integer('exit_code'),
    failureCode: text('failure_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notebook_execution_sessions_profile_idx').on(table.profileId, table.createdAt),
    index('notebook_execution_sessions_expiry_idx').on(table.status, table.expiresAt),
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

export const repositoryCompatibility = app.table(
  'repository_compatibility',
  {
    revisionId: uuid('revision_id')
      .primaryKey()
      .references(() => repositoryRevisions.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    architecture: text('architecture'),
    parameterCount: bigint('parameter_count', { mode: 'bigint' }),
    quantization: text('quantization'),
    tensorFormat: text('tensor_format'),
    modelSizeBytes: bigint('model_size_bytes', { mode: 'bigint' }).notNull().default(0n),
    minimumRamBytes: bigint('minimum_ram_bytes', { mode: 'bigint' }).notNull().default(0n),
    minimumVramBytes: bigint('minimum_vram_bytes', { mode: 'bigint' }).notNull().default(0n),
    cpuCompatible: boolean('cpu_compatible'),
    cudaCompatible: boolean('cuda_compatible'),
    rocmCompatible: boolean('rocm_compatible'),
    metalCompatible: boolean('metal_compatible'),
    mlxCompatible: boolean('mlx_compatible'),
    llamaCppCompatible: boolean('llama_cpp_compatible'),
    browserCompatible: boolean('browser_compatible'),
    confidence: text('confidence').notNull().default('derived'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('repository_compatibility_discovery_idx').on(
      table.minimumRamBytes,
      table.minimumVramBytes,
      table.cpuCompatible,
      table.cudaCompatible,
      table.rocmCompatible,
      table.metalCompatible,
      table.mlxCompatible,
      table.llamaCppCompatible,
      table.browserCompatible,
    ),
  ],
);

export const resourceGroups = app.table(
  'resource_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdByProfileId: uuid('created_by_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('resource_groups_organization_slug_idx').on(table.organizationId, table.slug)],
);

export const resourceGroupRepositories = app.table(
  'resource_group_repositories',
  {
    resourceGroupId: uuid('resource_group_id')
      .notNull()
      .references(() => resourceGroups.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.resourceGroupId, table.repositoryId] })],
);

export const resourceGroupMembers = app.table(
  'resource_group_members',
  {
    resourceGroupId: uuid('resource_group_id')
      .notNull()
      .references(() => resourceGroups.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.resourceGroupId, table.profileId] })],
);

export const serviceAccounts = app.table(
  'service_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdByProfileId: uuid('created_by_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('service_accounts_organization_name_idx').on(table.organizationId, table.name)],
);

export const serviceAccountRoles = app.table(
  'service_account_roles',
  {
    serviceAccountId: uuid('service_account_id')
      .notNull()
      .references(() => serviceAccounts.id, { onDelete: 'cascade' }),
    resourceGroupId: uuid('resource_group_id')
      .notNull()
      .references(() => resourceGroups.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.serviceAccountId, table.resourceGroupId] })],
);

export const trustedPublishers = app.table(
  'trusted_publishers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    audience: text('audience').notNull(),
    workflowRef: text('workflow_ref'),
    allowedScopes: jsonb('allowed_scopes').$type<string[]>().notNull().default([
      'repository:upload',
      'repository:commit',
      'repository:submit',
    ]),
    createdByProfileId: uuid('created_by_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    enabled: boolean('enabled').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('trusted_publishers_repository_enabled_idx').on(table.repositoryId, table.enabled)],
);

export const scopedAccessTokens = app.table(
  'scoped_access_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    serviceAccountId: uuid('service_account_id').references(() => serviceAccounts.id, {
      onDelete: 'cascade',
    }),
    trustedPublisherId: uuid('trusted_publisher_id').references(() => trustedPublishers.id, {
      onDelete: 'cascade',
    }),
    createdByProfileId: uuid('created_by_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scoped_access_tokens_active_idx').on(table.tokenHash, table.expiresAt)],
);

export const agentTraces = app.table(
  'agent_traces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').references(() => repositoryRevisions.id, {
      onDelete: 'set null',
    }),
    actorProfileId: uuid('actor_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    serviceAccountId: uuid('service_account_id').references(() => serviceAccounts.id, {
      onDelete: 'set null',
    }),
    trustedPublisherId: uuid('trusted_publisher_id').references(() => trustedPublishers.id, {
      onDelete: 'set null',
    }),
    traceId: text('trace_id').notNull(),
    agentName: text('agent_name').notNull(),
    toolName: text('tool_name'),
    status: text('status').notNull(),
    durationMs: integer('duration_ms'),
    inputSha256: text('input_sha256'),
    outputSha256: text('output_sha256'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    isPublic: boolean('is_public').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_traces_repository_trace_idx').on(table.repositoryId, table.traceId),
    index('agent_traces_public_repository_idx').on(table.repositoryId, table.occurredAt),
  ],
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

export const notifications = app.table(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    href: text('href'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_profile_created_idx').on(table.profileId, table.createdAt)],
);

export const paymentOrders = app.table(
  'payment_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    planId: text('plan_id').notNull().references(() => plans.id),
    seatCount: integer('seat_count').notNull().default(1),
    provider: text('provider').notNull().default('nowpayments'),
    providerPaymentId: text('provider_payment_id').unique(),
    priceAmountCents: integer('price_amount_cents').notNull(),
    priceCurrency: text('price_currency').notNull().default('usd'),
    payCurrency: text('pay_currency').notNull().default('usdc'),
    payNetwork: text('pay_network').notNull().default('eth'),
    payAmount: numeric('pay_amount', { precision: 30, scale: 12 }),
    payAddress: text('pay_address'),
    status: text('status').notNull().default('created'),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('payment_orders_profile_created_idx').on(table.profileId, table.createdAt)],
);

export const papers = app.table(
  'papers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerProfileId: uuid('owner_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    abstract: text('abstract').notNull(),
    canonicalUrl: text('canonical_url'),
    doi: text('doi'),
    publishedOn: date('published_on'),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('papers_owner_slug_idx').on(table.ownerProfileId, table.slug)],
);

export const posts = app.table(
  'posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    authorProfileId: uuid('author_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    body: text('body').notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('posts_author_slug_idx').on(table.authorProfileId, table.slug)],
);

export const paperRepositoryLinks = app.table(
  'paper_repository_links',
  {
    paperId: uuid('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    relationshipType: text('relationship_type').notNull().default('references'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.paperId, table.repositoryId, table.relationshipType] })],
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

export const externalIdentities = app.table(
  'external_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    providerUsername: text('provider_username').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    scopes: text('scopes').array().notNull(),
    organizations: jsonb('organizations').$type<Array<Record<string, unknown>>>().notNull().default([]),
    accessTokenCiphertext: text('access_token_ciphertext'),
    accessTokenNonce: text('access_token_nonce'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('external_identities_provider_subject_idx').on(table.provider, table.providerSubject),
    index('external_identities_profile_idx').on(table.profileId, table.provider, table.revokedAt),
  ],
);

export const bridgeOauthStates = app.table(
  'bridge_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    verifierCiphertext: text('verifier_ciphertext').notNull(),
    verifierNonce: text('verifier_nonce').notNull(),
    requestedScopes: text('requested_scopes').array().notNull(),
    returnPath: text('return_path').notNull().default('/bring-my-work'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bridge_oauth_states_expiry_idx').on(table.expiresAt)],
);

export const namespaceClaims = app.table(
  'namespace_claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalIdentityId: uuid('external_identity_id').notNull().references(() => externalIdentities.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerNamespace: text('provider_namespace').notNull(),
    targetHandle: text('target_handle').notNull(),
    namespaceKind: text('namespace_kind').notNull(),
    providerRole: text('provider_role'),
    status: text('status').notNull().default('verified'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('namespace_claims_profile_idx').on(table.profileId, table.status)],
);

export const bridgeImportJobs = app.table(
  'bridge_import_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    externalIdentityId: uuid('external_identity_id').references(() => externalIdentities.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    sourceUrl: text('source_url').notNull(),
    requestKey: text('request_key').notNull(),
    status: text('status').notNull().default('queued'),
    selectedCount: integer('selected_count').notNull().default(0),
    fileCount: integer('file_count').notNull().default(0),
    totalSizeBytes: bigint('total_size_bytes', { mode: 'bigint' }).notNull().default(0n),
    progressBytes: bigint('progress_bytes', { mode: 'bigint' }).notNull().default(0n),
    ownershipAttested: boolean('ownership_attested').notNull(),
    sourceUnchanged: boolean('source_unchanged').notNull().default(true),
    retryCount: integer('retry_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bridge_import_jobs_profile_request_idx').on(table.profileId, table.requestKey),
    index('bridge_import_jobs_worker_idx').on(table.status, table.nextAttemptAt, table.createdAt),
  ],
);

export const bridgeImportItems = app.table(
  'bridge_import_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id').notNull().references(() => bridgeImportJobs.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
    revisionId: uuid('revision_id').references(() => repositoryRevisions.id, { onDelete: 'set null' }),
    providerRepoId: text('provider_repo_id').notNull(),
    sourceNamespace: text('source_namespace').notNull(),
    sourceSlug: text('source_slug').notNull(),
    sourceRevision: text('source_revision').notNull(),
    sourceUrl: text('source_url').notNull(),
    kind: repositoryKind('kind').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    license: text('license'),
    sourceVisibility: text('source_visibility').notNull().default('public'),
    fileCount: integer('file_count').notNull(),
    totalSizeBytes: bigint('total_size_bytes', { mode: 'bigint' }).notNull(),
    largestFileBytes: bigint('largest_file_bytes', { mode: 'bigint' }).notNull(),
    status: text('status').notNull().default('queued'),
    blockedReason: text('blocked_reason'),
    progressBytes: bigint('progress_bytes', { mode: 'bigint' }).notNull().default(0n),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>().notNull().default({}),
    sourceManifest: jsonb('source_manifest').$type<Array<Record<string, unknown>>>().notNull().default([]),
    importedManifestSha256: text('imported_manifest_sha256'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bridge_import_items_job_idx').on(table.jobId, table.status, table.createdAt)],
);

export const repositorySources = app.table(
  'repository_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').notNull().references(() => repositoryRevisions.id, { onDelete: 'cascade' }).unique(),
    destinationProfileId: uuid('destination_profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    externalIdentityId: uuid('external_identity_id').references(() => externalIdentities.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    providerRepoId: text('provider_repo_id').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceRevision: text('source_revision').notNull(),
    observedLicense: text('observed_license'),
    sourceManifest: jsonb('source_manifest').$type<Array<Record<string, unknown>>>().notNull().default([]),
    importedManifestSha256: text('imported_manifest_sha256').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('repository_sources_lookup_idx').on(table.destinationProfileId, table.provider, table.providerRepoId, table.importedAt)],
);

export const bridgeSyncSubscriptions = app.table(
  'bridge_sync_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    externalIdentityId: uuid('external_identity_id').references(() => externalIdentities.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    providerRepoId: text('provider_repo_id').notNull(),
    kind: repositoryKind('kind').notNull(),
    sourceUrl: text('source_url').notNull(),
    lastSeenRevision: text('last_seen_revision').notNull(),
    lastImportJobId: uuid('last_import_job_id').references(() => bridgeImportJobs.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    checkIntervalSeconds: integer('check_interval_seconds').notNull().default(3600),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bridge_sync_subscriptions_due_idx').on(table.enabled, table.nextCheckAt)],
);

export const bridgeEvents = app.table(
  'bridge_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id').notNull().references(() => bridgeImportJobs.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => bridgeImportItems.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('bridge_events_job_idx').on(table.jobId, table.occurredAt)],
);

export const agentIdentities = app.table(
  'agent_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceAccountId: uuid('service_account_id').notNull().references(() => serviceAccounts.id, { onDelete: 'cascade' }).unique(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    handle: text('handle').notNull().unique(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull().default(''),
    framework: text('framework').notNull().default('other'),
    agentCardUrl: text('agent_card_url'),
    createdByProfileId: uuid('created_by_profile_id').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
    isPublic: boolean('is_public').notNull().default(false),
    status: text('status').notNull().default('active'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_identities_handle_lower_idx').on(table.handle),
    index('agent_identities_organization_idx').on(table.organizationId, table.status, table.createdAt),
  ],
);

export const agentAccessTokens = app.table(
  'agent_access_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentIdentityId: uuid('agent_identity_id').notNull().references(() => agentIdentities.id, { onDelete: 'cascade' }),
    createdByProfileId: uuid('created_by_profile_id').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
    resourceGroupId: uuid('resource_group_id').references(() => resourceGroups.id, { onDelete: 'cascade' }),
    maxActions: integer('max_actions').notNull().default(500),
    actionsUsed: integer('actions_used').notNull().default(0),
    spendLimitCents: integer('spend_limit_cents').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_access_tokens_active_idx').on(table.tokenHash, table.expiresAt),
    index('agent_access_tokens_identity_idx').on(table.agentIdentityId, table.createdAt),
  ],
);

export const agentActionReceipts = app.table(
  'agent_action_receipts',
  {
    sequence: bigint('sequence', { mode: 'bigint' }).notNull().unique(),
    id: uuid('id').defaultRandom().primaryKey(),
    agentIdentityId: uuid('agent_identity_id').notNull().references(() => agentIdentities.id, { onDelete: 'restrict' }),
    tokenId: uuid('token_id').references(() => agentAccessTokens.id, { onDelete: 'set null' }),
    operatorProfileId: uuid('operator_profile_id').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
    operatorOrganizationId: uuid('operator_organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    targetRef: text('target_ref'),
    requestedScopes: text('requested_scopes').array().notNull(),
    requestSha256: text('request_sha256').notNull(),
    resultSha256: text('result_sha256'),
    status: text('status').notNull(),
    reviewBoundary: text('review_boundary').notNull().default('human-review-required'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_action_receipts_idempotency_idx').on(table.agentIdentityId, table.idempotencyKey),
    index('agent_action_receipts_identity_idx').on(table.agentIdentityId, table.sequence),
    index('agent_action_receipts_target_idx').on(table.targetType, table.targetId, table.sequence),
  ],
);

export const agentEvents = app.table(
  'agent_events',
  {
    cursor: bigint('cursor', { mode: 'bigint' }).primaryKey(),
    id: uuid('id').defaultRandom().notNull().unique(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
    agentIdentityId: uuid('agent_identity_id').references(() => agentIdentities.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    visibility: text('visibility').notNull().default('operator'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_events_organization_cursor_idx').on(table.organizationId, table.cursor),
    index('agent_events_repository_cursor_idx').on(table.repositoryId, table.cursor),
    index('agent_events_agent_cursor_idx').on(table.agentIdentityId, table.cursor),
  ],
);

export const agentSubscriptions = app.table(
  'agent_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentIdentityId: uuid('agent_identity_id').notNull().references(() => agentIdentities.id, { onDelete: 'cascade' }),
    createdByProfileId: uuid('created_by_profile_id').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
    targetType: text('target_type').notNull().default('organization'),
    targetId: uuid('target_id').notNull(),
    eventTypes: text('event_types').array().notNull(),
    delivery: text('delivery').notNull().default('poll'),
    acknowledgedCursor: bigint('acknowledged_cursor', { mode: 'bigint' }).notNull().default(0n),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_subscriptions_target_idx').on(table.agentIdentityId, table.targetType, table.targetId),
    index('agent_subscriptions_enabled_idx').on(table.agentIdentityId, table.enabled, table.updatedAt),
  ],
);

export const agentContributionJobs = app.table(
  'agent_contribution_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    createdByProfileId: uuid('created_by_profile_id').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    inputSha256: text('input_sha256').notNull(),
    rewardLabel: text('reward_label').notNull().default('community reputation'),
    status: text('status').notNull().default('open'),
    claimedByAgentId: uuid('claimed_by_agent_id').references(() => agentIdentities.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    reviewRequired: boolean('review_required').notNull().default(true),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_contribution_jobs_open_idx').on(table.status, table.createdAt),
    index('agent_contribution_jobs_agent_idx').on(table.claimedByAgentId, table.status, table.updatedAt),
  ],
);

export const agentContributionSubmissions = app.table(
  'agent_contribution_submissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id').notNull().references(() => agentContributionJobs.id, { onDelete: 'cascade' }),
    agentIdentityId: uuid('agent_identity_id').notNull().references(() => agentIdentities.id, { onDelete: 'restrict' }),
    receiptId: uuid('receipt_id').notNull().references(() => agentActionReceipts.id, { onDelete: 'restrict' }),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    resultSha256: text('result_sha256').notNull(),
    status: text('status').notNull().default('submitted'),
    reviewedByProfileId: uuid('reviewed_by_profile_id').references(() => profiles.id, { onDelete: 'restrict' }),
    reviewNotes: text('review_notes'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agent_contribution_submissions_job_agent_idx').on(table.jobId, table.agentIdentityId),
    index('agent_contribution_submissions_agent_idx').on(table.agentIdentityId, table.status, table.submittedAt),
  ],
);
