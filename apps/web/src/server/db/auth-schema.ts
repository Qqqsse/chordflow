import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { arrangements } from './schema';

/*
 * Accounts (SPEC §12). Tables follow better-auth's user/session/account/
 * verification models (property names are its field names); `role` is an
 * extra, server-only field. Invitations store only a SHA-256 hash of the
 * token, which is shown to the admin once.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const authUsers = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role').notNull().default('member'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_users_email').on(sql`lower(${t.email})`),
    check('auth_users_role', sql`${t.role} in ('member', 'admin')`),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('auth_sessions_user').on(t.userId)],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    /** Argon2id hash (credential provider only). */
    password: text('password'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('auth_accounts_user').on(t.userId)],
);

export const authVerifications = pgTable('auth_verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    role: text('role').notNull().default('member'),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => authUsers.id),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    usedBy: text('used_by').references(() => authUsers.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [check('invitations_role', sql`${t.role} in ('member', 'admin')`)],
);

export const favorites = pgTable(
  'favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    arrangementId: text('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.arrangementId] })],
);

export const AUDIT_ACTIONS = ['created', 'settings_changed', 'revision_published'] as const;

/** Snapshot of what an audit event records about an arrangement's rights. */
export interface RightsSnapshot {
  visibility: string;
  rights: {
    lyrics: string;
    chart: string;
    audio: string;
    attribution: string | null;
    notes: string | null;
  };
  publishedRevisionId: string | null;
}

/**
 * Append-only rights/visibility audit log (SPEC §16 M9). Rows are written in
 * the same transaction as the change; a trigger forbids UPDATE and DELETE.
 */
export const arrangementAuditEvents = pgTable(
  'arrangement_audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    arrangementId: text('arrangement_id')
      .notNull()
      .references(() => arrangements.id),
    actorUserId: text('actor_user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    before: jsonb('before').$type<RightsSnapshot>(),
    after: jsonb('after').$type<RightsSnapshot>().notNull(),
    details: jsonb('details').$type<Record<string, string>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('arrangement_audit_events_arrangement').on(t.arrangementId, t.id),
    check(
      'arrangement_audit_events_action',
      sql.raw(`action in (${AUDIT_ACTIONS.map((a) => `'${a}'`).join(', ')})`),
    ),
  ],
);

/** Recently opened charts per user; the service keeps only the newest few per user. */
export const recentViews = pgTable(
  'recent_views',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    arrangementId: text('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    viewedAt: ts('viewed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.arrangementId] }),
    index('recent_views_user_time').on(t.userId, t.viewedAt),
  ],
);

/** Per-user viewer preferences for one arrangement (never mutates the chart). */
export const userChartPreferences = pgTable(
  'user_chart_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    arrangementId: text('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.arrangementId] })],
);
