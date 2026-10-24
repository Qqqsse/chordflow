import { NewRevisionRequestSchema } from '@chordflow/chart-schema';
import { importChordPro } from '@chordflow/chordpro';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { getCatalog } from '@/server/catalog';
import { createRevision } from '@/server/catalog/editor';
import { toApiProblem } from '@/server/catalog/editor-errors';
import { requireId } from '@/server/catalog/lookups';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Creates a new draft revision. Admins, or the arrangement's owner. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const arrangementId = requireId((await params).id, 'ARRANGEMENT_NOT_FOUND');
    const owner = await getCatalog().getArrangementOwnerId(arrangementId);
    if (user.role !== 'admin' && owner !== user.userId) {
      throw new ApiProblem(404, 'ARRANGEMENT_NOT_FOUND', 'Arrangement was not found');
    }
    const parsed = NewRevisionRequestSchema.safeParse(await readJsonBody(request, 512 * 1024));
    if (
      !parsed.success ||
      (parsed.data.document === undefined) === (parsed.data.chordpro === undefined)
    ) {
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Provide exactly one of document or chordpro');
    }
    const { chordpro, parentRevisionId, expectedLatestRevision } = parsed.data;
    let document: Record<string, unknown>;
    let origin: 'human' | 'chordpro_import' = 'human';
    if (chordpro !== undefined) {
      const imported = importChordPro(chordpro.source, {
        chartRevisionId: 'pending',
        arrangementId,
        ...(chordpro.title === undefined ? {} : { defaultTitle: chordpro.title }),
        ...(chordpro.chordsWrittenAs === undefined
          ? {}
          : { chordsWrittenAs: chordpro.chordsWrittenAs }),
      });
      if (!imported.ok)
        throw new ApiProblem(422, 'VALIDATION_FAILED', 'ChordPro import failed', {
          issues: imported.issues,
        });
      document = imported.document;
      origin = 'chordpro_import';
    } else {
      document = parsed.data.document ?? {};
    }
    const created = await createRevision(user.db, {
      arrangementId,
      document: document as never,
      origin,
      parentRevisionId,
      ...(expectedLatestRevision === undefined ? {} : { expectedLatestRevision }),
      createdBy: user.userId,
    }).catch(toApiProblem);
    return ok(created, requestId, 201);
  },
);
