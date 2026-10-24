import { asc, eq } from 'drizzle-orm';
import {
  arrangementAuditEvents,
  authUsers,
  type AUDIT_ACTIONS,
  type RightsSnapshot,
} from '../db/auth-schema';
import type { Database } from '../db/client';
import * as t from '../db/schema';

/* Rights/visibility audit trail for arrangements (append-only; see migration 0006). */

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Current visibility, rights and published pointer, read inside the caller's transaction. */
export async function rightsSnapshot(
  tx: Database,
  arrangementId: string,
): Promise<RightsSnapshot | null> {
  const [row] = await tx.select().from(t.arrangements).where(eq(t.arrangements.id, arrangementId));
  if (!row) return null;
  return {
    visibility: row.visibility,
    rights: {
      lyrics: row.rightsLyrics,
      chart: row.rightsChart,
      audio: row.rightsAudio,
      attribution: row.rightsAttribution,
      notes: row.rightsNotes,
    },
    publishedRevisionId: row.publishedRevisionId,
  };
}

export async function recordAudit(
  tx: Database,
  event: {
    arrangementId: string;
    actorUserId: string | null;
    action: AuditAction;
    before: RightsSnapshot | null;
    after: RightsSnapshot;
    details?: Record<string, string>;
  },
): Promise<void> {
  await tx.insert(arrangementAuditEvents).values({
    arrangementId: event.arrangementId,
    actorUserId: event.actorUserId,
    action: event.action,
    before: event.before,
    after: event.after,
    details: event.details ?? {},
  });
}

export async function listAudit(db: Database, arrangementId: string) {
  const rows = await db
    .select({ event: arrangementAuditEvents, actorName: authUsers.name })
    .from(arrangementAuditEvents)
    .leftJoin(authUsers, eq(authUsers.id, arrangementAuditEvents.actorUserId))
    .where(eq(arrangementAuditEvents.arrangementId, arrangementId))
    .orderBy(asc(arrangementAuditEvents.id));
  return rows.map(({ event, actorName }) => ({
    id: event.id,
    action: event.action as AuditAction,
    actor: event.actorUserId === null ? null : { id: event.actorUserId, name: actorName ?? '' },
    before: event.before,
    after: event.after,
    details: event.details,
    at: event.createdAt.toISOString(),
  }));
}
