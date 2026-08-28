import {
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
