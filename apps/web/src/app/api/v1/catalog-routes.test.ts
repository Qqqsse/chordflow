import {
  ApiErrorSchema,
  ArrangementDetailSchema,
  ChartRevisionDataSchema,
  ReadinessDataSchema,
  RecordingDetailSchema,
  RecordingSyncDataSchema,
  SearchDataSchema,
  WorkDetailSchema,
  envelopeOf,
} from '@chordflow/chart-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { GET as getArrangement } from './arrangements/[id]/route';
import { GET as getRevision } from './arrangements/[id]/revisions/[rev]/route';
import { GET as getReady } from './ready/route';
import { GET as getRecording } from './recordings/[id]/route';
import { GET as getSync } from './recordings/[id]/sync/route';
import { GET as search } from './search/route';
import { GET as getWork } from './works/[id]/route';

const req = (path: string) =>
  new Request(`http://localhost${path}`, { headers: { 'x-request-id': 'req_test' } });
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

async function data<S extends z.ZodType>(
  response: Response,
  schema: S,
  status = 200,
): Promise<z.infer<S>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  const envelope = envelopeOf(schema).parse(body) as { data: unknown };
  return schema.parse(envelope.data);
}

async function error(response: Response, status: number, code: string) {
  const body = ApiErrorSchema.parse(await response.json());
  expect(response.status).toBe(status);
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe('req_test');
}

beforeEach(() => {
  vi.stubEnv('CHORDFLOW_DATA_MODE', 'demo');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/v1/search', () => {
  it('finds works with recordings and arrangements', async () => {
    const result = await data(
      await search(req('/api/v1/search?q=送別'), undefined),
      SearchDataSchema,
    );
    expect(result.items.map((i) => i.work.id)).toEqual(['work_pd_songbie']);
    expect(result.items[0]?.arrangements[0]).toMatchObject({
      id: 'arr_pd_songbie_001',
      hasPublishedChart: true,
    });
    expect(result.items[0]?.work.credits.map((c) => c.artist.name)).toEqual([
      '李叔同',
      'John P. Ordway',
    ]);
  });

  it('distinguishes studio, live and cover recordings and flags unverified mappings', async () => {
    const result = await data(
      await search(req('/api/v1/search?q=示範歌曲'), undefined),
      SearchDataSchema,
    );
    const hit = result.items.find((i) => i.work.id === 'work_demo_001');
    expect(hit?.recordings.map((r) => [r.kind, r.mappings[0]?.verified])).toEqual([
      ['studio', true],
      ['live', true],
      ['cover', false],
    ]);
  });

  it('pages with an opaque cursor', async () => {
    const first = await data(
      await search(req('/api/v1/search?q=示範&limit=1'), undefined),
      SearchDataSchema,
    );
    expect(first.nextCursor).not.toBeNull();
    const second = await data(
      await search(
        req(`/api/v1/search?q=示範&limit=1&cursor=${first.nextCursor ?? ''}`),
        undefined,
      ),
      SearchDataSchema,
    );
    expect(second.items[0]?.work.id).not.toBe(first.items[0]?.work.id);
    await error(
      await search(req(`/api/v1/search?q=other&cursor=${first.nextCursor ?? ''}`), undefined),
      400,
      'INVALID_QUERY',
    );
  });

  it('resolves a supported source URL without fetching it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const url = encodeURIComponent('https://youtu.be/DEMO0000001');
    const result = await data(
      await search(req(`/api/v1/search?q=${url}`), undefined),
      SearchDataSchema,
    );
    expect(result.source).toEqual({
      platform: 'youtube',
      platformSourceId: 'DEMO0000001',
      matchedSourceId: 'src_demo_video_001',
    });
    expect(result.items.map((i) => i.work.id)).toEqual(['work_demo_001']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects unsupported URLs instead of fetching them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const url = encodeURIComponent('https://169.254.169.254/latest/meta-data');
    await error(await search(req(`/api/v1/search?q=${url}`), undefined), 400, 'INVALID_QUERY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'q=',
    `q=${'長'.repeat(101)}`,
    'q=！？',
    'q=a&limit=0',
    'q=a&limit=51',
    'q=a&limit=x',
  ])('rejects %j with INVALID_QUERY', async (query) => {
    await error(await search(req(`/api/v1/search?${query}`), undefined), 400, 'INVALID_QUERY');
  });
});

describe('detail routes', () => {
  it('GET /works/{id}', async () => {
    const work = await data(
      await getWork(req('/x'), params({ id: 'work_demo_001' })),
      WorkDetailSchema,
    );
    expect(work.recordings).toHaveLength(3);
    await error(await getWork(req('/x'), params({ id: 'work_missing' })), 404, 'WORK_NOT_FOUND');
    await error(await getWork(req('/x'), params({ id: '../etc' })), 404, 'WORK_NOT_FOUND');
  });

  it('GET /recordings/{id}', async () => {
    const live = await data(
      await getRecording(req('/x'), params({ id: 'rec_demo_002' })),
      RecordingDetailSchema,
    );
    expect(live.recording.kind).toBe('live');
    expect(live.arrangements.map((a) => a.id)).toEqual(['arr_demo_001']);
    const cover = await data(
      await getRecording(req('/x'), params({ id: 'rec_demo_003' })),
      RecordingDetailSchema,
    );
    expect(cover.sources).toEqual([
      expect.objectContaining({ platform: 'youtube', permission: 'discovery_only' }),
    ]);
    await error(
      await getRecording(req('/x'), params({ id: 'rec_missing' })),
      404,
      'RECORDING_NOT_FOUND',
    );
  });

  it('GET /arrangements/{id}', async () => {
    const detail = await data(
      await getArrangement(req('/x'), params({ id: 'arr_demo_001' })),
      ArrangementDetailSchema,
    );
    expect(detail.revisions.map((r) => [r.revision, r.status])).toEqual([[1, 'published']]);
    expect(detail.mappings).toHaveLength(3);
    await error(
      await getArrangement(req('/x'), params({ id: 'arr_missing' })),
      404,
      'ARRANGEMENT_NOT_FOUND',
    );
  });

  it('GET /arrangements/{id}/revisions/{rev}', async () => {
    const revision = await data(
      await getRevision(req('/x'), params({ id: 'arr_demo_001', rev: '1' })),
      ChartRevisionDataSchema,
    );
    expect(revision.document.chartRevisionId).toBe('rev_demo_001');
    for (const rev of ['2', '0', 'abc', '1.5', '01']) {
      await error(
        await getRevision(req('/x'), params({ id: 'arr_demo_001', rev })),
        404,
        'CHART_NOT_FOUND',
      );
    }
  });

  it('GET /recordings/{id}/sync', async () => {
    const sync = await data(
      await getSync(req('/x?revisionId=rev_demo_001'), params({ id: 'rec_demo_002' })),
      RecordingSyncDataSchema,
    );
    expect(sync.recordingId).toBe('rec_demo_002');
    await error(
      await getSync(req('/x?revisionId=rev_demo_001'), params({ id: 'rec_demo_003' })),
      404,
      'SYNC_NOT_FOUND',
    );
    await error(await getSync(req('/x'), params({ id: 'rec_demo_001' })), 400, 'INVALID_QUERY');
  });

  it('GET /ready reports the database as not configured in demo mode', async () => {
    const ready = await data(await getReady(req('/x'), undefined), ReadinessDataSchema);
    expect(ready).toEqual({ status: 'ready', checks: { database: 'not_configured' } });
  });

  it('never leaks internal errors', async () => {
    vi.stubEnv('CHORDFLOW_DATA_MODE', 'bogus');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await error(
      await getWork(req('/x'), params({ id: 'work_demo_001' })),
      500,
      'CONFIGURATION_INVALID',
    );
  });
});
