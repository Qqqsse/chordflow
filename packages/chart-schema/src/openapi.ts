import { z } from 'zod';
import {
  API_VERSION,
  ApiErrorSchema,
  ArrangementDetailSchema,
  ChartRevisionDataSchema,
  HealthDataSchema,
  ReadinessDataSchema,
  RecordingDetailSchema,
  RecordingSyncDataSchema,
  SearchDataSchema,
  WorkDetailSchema,
  envelopeOf,
} from './api';

/*
 * OpenAPI 3.1 document for the `/api/v1` contract (SPEC §10), generated from
 * the same Zod schemas the server and tests use. Checked in under openapi/.
 */

type Json = Record<string, unknown>;

const schema = (s: z.ZodType): Json => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s, {
    target: 'draft-2020-12',
    io: 'output',
  }) as Json;
  return rest;
};

const COMPONENTS = {
  Error: ApiErrorSchema,
  HealthResponse: envelopeOf(HealthDataSchema),
  ReadinessResponse: envelopeOf(ReadinessDataSchema),
  SearchResponse: envelopeOf(SearchDataSchema),
  WorkResponse: envelopeOf(WorkDetailSchema),
  RecordingResponse: envelopeOf(RecordingDetailSchema),
  ArrangementResponse: envelopeOf(ArrangementDetailSchema),
  ChartRevisionResponse: envelopeOf(ChartRevisionDataSchema),
  RecordingSyncResponse: envelopeOf(RecordingSyncDataSchema),
} as const;

const ref = (name: keyof typeof COMPONENTS) => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

const okResponse = (name: keyof typeof COMPONENTS, description = 'OK') => ({
  description,
  content: { 'application/json': { schema: ref(name) } },
});

const idParam = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' },
});

const requestIdHeader = {
  name: 'x-request-id',
  in: 'header',
  required: false,
  description:
    'Optional client request id ([A-Za-z0-9._-]{1,64}); echoed back, otherwise generated.',
  schema: { type: 'string' },
};

export function buildOpenApi(): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: 'chordflow API',
      version: API_VERSION,
      description:
        'Envelope: success `{ data, meta: { requestId, schemaVersion } }`, error `{ error: { code, message, details, requestId } }`. Hidden and missing resources both return 404.',
    },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/health': {
        get: {
          summary: 'Liveness (no secrets)',
          parameters: [requestIdHeader],
          responses: {
            200: okResponse('HealthResponse'),
            500: errorResponse('Configuration invalid'),
          },
        },
      },
      '/ready': {
        get: {
          summary: 'Readiness (database reachability in database mode)',
          responses: {
            200: okResponse('ReadinessResponse'),
            503: okResponse('ReadinessResponse', 'Not ready'),
          },
        },
      },
      '/search': {
        get: {
          summary:
            'Search works, recordings and arrangements; supported source URLs are resolved without fetching',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 100 },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
            requestIdHeader,
          ],
          responses: { 200: okResponse('SearchResponse'), 400: errorResponse('INVALID_QUERY') },
        },
      },
      '/works/{id}': {
        get: {
          summary: 'Work with recordings and visible arrangements',
          parameters: [idParam('id', 'Work id'), requestIdHeader],
          responses: { 200: okResponse('WorkResponse'), 404: errorResponse('WORK_NOT_FOUND') },
        },
      },
      '/recordings/{id}': {
        get: {
          summary: 'Recording with sources and arrangement mappings',
          parameters: [idParam('id', 'Recording id'), requestIdHeader],
          responses: {
            200: okResponse('RecordingResponse'),
            404: errorResponse('RECORDING_NOT_FOUND'),
          },
        },
      },
      '/recordings/{id}/sync': {
        get: {
          summary: 'Recording-specific timing for one chart revision',
          parameters: [
            idParam('id', 'Recording id'),
            { name: 'revisionId', in: 'query', required: true, schema: { type: 'string' } },
            requestIdHeader,
          ],
          responses: {
            200: okResponse('RecordingSyncResponse'),
            400: errorResponse('INVALID_QUERY'),
            404: errorResponse('SYNC_NOT_FOUND'),
          },
        },
      },
      '/arrangements/{id}': {
        get: {
          summary: 'Arrangement summary, rights, visible revisions and mappings',
          parameters: [idParam('id', 'Arrangement id'), requestIdHeader],
          responses: {
            200: okResponse('ArrangementResponse'),
            404: errorResponse('ARRANGEMENT_NOT_FOUND'),
          },
        },
      },
      '/arrangements/{id}/revisions/{rev}': {
        get: {
          summary: 'Canonical Chart Document of one revision',
          parameters: [
            idParam('id', 'Arrangement id'),
            {
              name: 'rev',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[1-9][0-9]{0,6}$' },
            },
            requestIdHeader,
          ],
          responses: {
            200: okResponse('ChartRevisionResponse'),
            404: errorResponse('CHART_NOT_FOUND'),
          },
        },
      },
    },
    components: {
      schemas: Object.fromEntries(Object.entries(COMPONENTS).map(([name, s]) => [name, schema(s)])),
    },
  };
}
