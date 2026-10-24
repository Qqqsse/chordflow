import { ChordProImportRequestSchema } from '@chordflow/chart-schema';
import { importChordPro } from '@chordflow/chordpro';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { assertSameOrigin, rateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Bounded ChordPro parse returning a preview only; nothing is stored (SPEC §10). */
export const POST = apiRoute(async (request: Request, _context: unknown, requestId) => {
  assertSameOrigin(request);
  await requireUser(request);
  rateLimit(request, 'chordpro-import', 60, 60_000);
  const parsed = ChordProImportRequestSchema.safeParse(await readJsonBody(request, 256 * 1024));
  if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid import request');
  const { source, title, language, chordsWrittenAs } = parsed.data;
  const result = importChordPro(source, {
    chartRevisionId: 'preview',
    arrangementId: 'preview',
    ...(title === undefined ? {} : { defaultTitle: title }),
    ...(language === undefined ? {} : { language }),
    ...(chordsWrittenAs === undefined ? {} : { chordsWrittenAs }),
  });
  return ok(
    { ok: result.ok, document: result.document, metadata: result.metadata, issues: result.issues },
    requestId,
    result.ok ? 200 : 422,
  );
});
