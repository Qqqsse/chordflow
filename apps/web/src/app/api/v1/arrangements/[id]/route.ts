import { isVerifiedCompatibility } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { canViewRevision } from '@/server/access';
import { requireAdmin } from '@/server/auth/guards';
import { getPrincipal } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { requireVisibleArrangement } from '@/server/catalog/lookups';
import { ArrangementSettingsSchema, updateArrangementSettings } from '@/server/catalog/editor';
import { toApiProblem } from '@/server/catalog/editor-errors';
import { toArrangementSummary, toWorkSummary } from '@/server/catalog/views';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const repo = getCatalog();
    const principal = await getPrincipal(request);
    const arrangement = await requireVisibleArrangement(repo, principal, (await params).id);
    const ownerUserId = await repo.getArrangementOwnerId(arrangement.id);
    const [work, revisions, mappings] = await Promise.all([
      repo.getWork(arrangement.workId),
      repo.listRevisions(arrangement.id),
      repo.listCompatibilities({ arrangementId: arrangement.id }),
    ]);
    if (work === null) throw new Error('arrangement without work');
    return ok(
      {
        arrangement: toArrangementSummary(arrangement),
        rights: arrangement.rights,
        work: await toWorkSummary(repo, work),
        revisions: revisions
          .filter((r) => canViewRevision(principal, { ...arrangement, ownerUserId }, r))
          .map((r) => ({
            id: r.id,
            revision: r.revision,
            status: r.status,
            origin: r.origin,
            createdAt: r.createdAt,
          })),
        mappings: mappings.map((m) => ({
          arrangementId: m.arrangementId,
          recordingId: m.recordingId,
          provenance: m.provenance,
          verified: isVerifiedCompatibility(m.provenance),
          recordedKey: m.recordedKey,
          transposeSemitones: m.transposeSemitones,
        })),
      },
      requestId,
    );
  },
);

/** Updates visibility and per-asset rights (admin only); rights must allow the visibility. */
export const PATCH = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    assertSameOrigin(request);
    const { db, userId } = await requireAdmin(request);
    const id = (await params).id;
    const parsed = ArrangementSettingsSchema.safeParse(await readJsonBody(request, 8 * 1024));
    if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid settings');
    await updateArrangementSettings(db, id, parsed.data, userId).catch(toApiProblem);
    return ok({ id }, requestId);
  },
);
