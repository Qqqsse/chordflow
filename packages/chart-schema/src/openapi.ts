import { z } from 'zod';
import {
  API_VERSION,
  ApiErrorSchema,
  ArrangementDetailSchema,
  ArrangementSettingsRequestSchema,
  ChordProImportDataSchema,
  ChordProImportRequestSchema,
  InvitationAcceptRequestSchema,
  InvitationCreateRequestSchema,
  InvitationCreatedDataSchema,
  NewArrangementDataSchema,
  NewArrangementRequestSchema,
  NewRevisionDataSchema,
  NewRevisionRequestSchema,
  PublishDataSchema,
  PublishRequestSchema,
  ChartRevisionDataSchema,
  HealthDataSchema,
  ReadinessDataSchema,
  RecordingDetailSchema,
  RecordingSyncDataSchema,
  SearchDataSchema,
  WorkDetailSchema,
  envelopeOf,
} from './api';
import {
  GenerationJobCreateRequestSchema,
  GenerationJobCreatedDataSchema,
  GenerationJobDataSchema,
  GenerationJobListDataSchema,
  GenerationJobResultDataSchema,
  GenerationJobReviewDataSchema,
  GenerationJobReviewRequestSchema,
  WorkerClaimDataSchema,
  WorkerClaimRequestSchema,
  WorkerCompleteDataSchema,
  WorkerCompleteRequestSchema,
  WorkerFailDataSchema,
  WorkerFailRequestSchema,
  WorkerHeartbeatDataSchema,
  WorkerHeartbeatRequestSchema,
} from './generation';

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
  ChordProImportRequest: ChordProImportRequestSchema,
  ChordProImportResponse: envelopeOf(ChordProImportDataSchema),
  NewArrangementRequest: NewArrangementRequestSchema,
  NewArrangementResponse: envelopeOf(NewArrangementDataSchema),
  ArrangementSettingsRequest: ArrangementSettingsRequestSchema,
  NewRevisionRequest: NewRevisionRequestSchema,
  NewRevisionResponse: envelopeOf(NewRevisionDataSchema),
  PublishRequest: PublishRequestSchema,
  PublishResponse: envelopeOf(PublishDataSchema),
  InvitationCreateRequest: InvitationCreateRequestSchema,
  InvitationCreatedResponse: envelopeOf(InvitationCreatedDataSchema),
  InvitationAcceptRequest: InvitationAcceptRequestSchema,
  GenerationJobCreateRequest: GenerationJobCreateRequestSchema,
  GenerationJobCreatedResponse: envelopeOf(GenerationJobCreatedDataSchema),
  GenerationJobResponse: envelopeOf(GenerationJobDataSchema),
  GenerationJobListResponse: envelopeOf(GenerationJobListDataSchema),
  GenerationJobResultResponse: envelopeOf(GenerationJobResultDataSchema),
  GenerationJobReviewRequest: GenerationJobReviewRequestSchema,
  GenerationJobReviewResponse: envelopeOf(GenerationJobReviewDataSchema),
  WorkerClaimRequest: WorkerClaimRequestSchema,
  WorkerClaimResponse: envelopeOf(WorkerClaimDataSchema),
  WorkerHeartbeatRequest: WorkerHeartbeatRequestSchema,
  WorkerHeartbeatResponse: envelopeOf(WorkerHeartbeatDataSchema),
  WorkerCompleteRequest: WorkerCompleteRequestSchema,
  WorkerCompleteResponse: envelopeOf(WorkerCompleteDataSchema),
  WorkerFailRequest: WorkerFailRequestSchema,
  WorkerFailResponse: envelopeOf(WorkerFailDataSchema),
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

const jsonBody = (name: keyof typeof COMPONENTS) => ({
  required: true,
  content: { 'application/json': { schema: ref(name) } },
});

/** Writes need a session cookie and an Origin header equal to APP_BASE_URL. */
const WRITE_ERRORS = {
  401: errorResponse('UNAUTHENTICATED'),
  403: errorResponse('FORBIDDEN or CSRF_REJECTED'),
  404: errorResponse('Not available in demo mode, or resource not found'),
  413: errorResponse('PAYLOAD_TOO_LARGE'),
  422: errorResponse('VALIDATION_FAILED'),
};

/** Worker routes use a bearer token (WORKER_TOKEN), never a user session. */
const WORKER_ERRORS = {
  401: errorResponse('UNAUTHENTICATED (missing or wrong worker token)'),
  413: errorResponse('PAYLOAD_TOO_LARGE'),
  422: errorResponse('VALIDATION_FAILED'),
  503: errorResponse('SERVICE_UNAVAILABLE (worker API not configured)'),
};
const workerSecurity = [{ workerToken: [] }];

const jobPath = (summary: string, extra: Record<string, unknown>) => ({
  summary,
  parameters: [idParam('id', 'Generation job id')],
  ...extra,
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
        patch: {
          summary: 'Set visibility and per-asset rights (admin); rights must allow the visibility',
          parameters: [idParam('id', 'Arrangement id')],
          requestBody: jsonBody('ArrangementSettingsRequest'),
          responses: {
            200: { description: 'Updated' },
            ...WRITE_ERRORS,
            422: errorResponse('VALIDATION_FAILED or PUBLISH_REJECTED'),
          },
        },
      },
      '/arrangements': {
        post: {
          summary: 'Create an arrangement, and its work when new (admin)',
          requestBody: jsonBody('NewArrangementRequest'),
          responses: { 201: okResponse('NewArrangementResponse', 'Created'), ...WRITE_ERRORS },
        },
      },
      '/arrangements/{id}/revisions': {
        post: {
          summary: 'Create a draft revision from a document or ChordPro (admin or owner)',
          parameters: [idParam('id', 'Arrangement id')],
          requestBody: jsonBody('NewRevisionRequest'),
          responses: {
            201: okResponse('NewRevisionResponse', 'Created'),
            ...WRITE_ERRORS,
            409: errorResponse('REVISION_CONFLICT (expectedLatestRevision is stale)'),
          },
        },
      },
      '/arrangements/{id}/publish': {
        post: {
          summary: 'Transactional, rights- and review-gated publish (admin); idempotent',
          parameters: [idParam('id', 'Arrangement id')],
          requestBody: jsonBody('PublishRequest'),
          responses: {
            200: okResponse('PublishResponse'),
            ...WRITE_ERRORS,
            422: errorResponse('PUBLISH_REJECTED'),
          },
        },
      },
      '/chordpro/import': {
        post: {
          summary: 'Parse ChordPro into a preview (members); nothing is stored',
          requestBody: jsonBody('ChordProImportRequest'),
          responses: {
            200: okResponse('ChordProImportResponse'),
            ...WRITE_ERRORS,
            422: okResponse('ChordProImportResponse', 'Import errors (issues with line numbers)'),
          },
        },
      },
      '/invitations': {
        post: {
          summary: 'Create an invitation (admin); the token is returned once',
          requestBody: jsonBody('InvitationCreateRequest'),
          responses: { 201: okResponse('InvitationCreatedResponse', 'Created'), ...WRITE_ERRORS },
        },
      },
      '/invitations/accept': {
        post: {
          summary: 'Accept an invitation, create the account and start a session',
          requestBody: jsonBody('InvitationAcceptRequest'),
          responses: {
            201: { description: 'Account created; session cookie set' },
            403: errorResponse('FORBIDDEN (invalid, expired or used invitation) or CSRF_REJECTED'),
            409: errorResponse('Email already registered'),
            422: errorResponse('VALIDATION_FAILED'),
            429: errorResponse('RATE_LIMITED'),
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
      '/generation-jobs': {
        post: {
          summary:
            'Submit a generation job (members, quota-limited); same idempotency key or equivalent active request returns the existing job',
          requestBody: jsonBody('GenerationJobCreateRequest'),
          responses: {
            200: okResponse('GenerationJobCreatedResponse', 'Existing job reused'),
            201: okResponse('GenerationJobCreatedResponse', 'Created'),
            ...WRITE_ERRORS,
            409: errorResponse('IDEMPOTENCY_CONFLICT (key reused with a different request)'),
            422: errorResponse('VALIDATION_FAILED or SOURCE_NOT_AUTHORIZED'),
            429: errorResponse('QUOTA_EXCEEDED or RATE_LIMITED'),
          },
        },
        get: {
          summary: 'Recent jobs: own jobs, or all jobs for administrators',
          responses: { 200: okResponse('GenerationJobListResponse'), ...WRITE_ERRORS },
        },
      },
      '/generation-jobs/{id}': {
        get: jobPath('Job status, limited progress, typed error and draft ids (owner/admin)', {
          responses: {
            200: okResponse('GenerationJobResponse'),
            401: errorResponse('UNAUTHENTICATED'),
            404: errorResponse('JOB_NOT_FOUND'),
          },
        }),
      },
      '/generation-jobs/{id}/result': {
        get: jobPath('Draft revision, quality report and artifact manifest (owner/admin)', {
          responses: {
            200: okResponse('GenerationJobResultResponse'),
            401: errorResponse('UNAUTHENTICATED'),
            404: errorResponse('JOB_NOT_FOUND or RESULT_NOT_AVAILABLE'),
          },
        }),
      },
      '/generation-jobs/{id}/cancel': {
        post: jobPath('Cancel a job that has not produced a draft yet (owner/admin)', {
          responses: {
            200: okResponse('GenerationJobResponse'),
            ...WRITE_ERRORS,
            409: errorResponse('JOB_STATE_CONFLICT'),
          },
        }),
      },
      '/generation-jobs/{id}/review': {
        post: jobPath('Publish the draft (or a revision derived from it) or reject it (admin)', {
          requestBody: jsonBody('GenerationJobReviewRequest'),
          responses: {
            200: okResponse('GenerationJobReviewResponse'),
            ...WRITE_ERRORS,
            409: errorResponse('JOB_STATE_CONFLICT'),
            422: errorResponse('PUBLISH_REJECTED'),
          },
        }),
      },
      '/worker/jobs/claim': {
        post: {
          summary: 'Atomically lease the next eligible job (expired leases are requeued first)',
          security: workerSecurity,
          requestBody: jsonBody('WorkerClaimRequest'),
          responses: { 200: okResponse('WorkerClaimResponse'), ...WORKER_ERRORS },
        },
      },
      '/worker/jobs/{id}/heartbeat': {
        post: jobPath('Renew the lease and report progress', {
          security: workerSecurity,
          requestBody: jsonBody('WorkerHeartbeatRequest'),
          responses: {
            200: okResponse('WorkerHeartbeatResponse'),
            ...WORKER_ERRORS,
            409: errorResponse('LEASE_LOST (expired, reassigned or job cancelled)'),
          },
        }),
      },
      '/worker/jobs/{id}/complete': {
        post: jobPath(
          'Submit the draft, quality report and artifact manifest; repeating the same completion returns the same outcome',
          {
            security: workerSecurity,
            requestBody: jsonBody('WorkerCompleteRequest'),
            responses: {
              200: okResponse('WorkerCompleteResponse'),
              ...WORKER_ERRORS,
              409: errorResponse('LEASE_LOST'),
              422: errorResponse('ARTIFACT_VALIDATION_FAILED (job fails terminally)'),
            },
          },
        ),
      },
      '/worker/jobs/{id}/fail': {
        post: jobPath('Report a typed failure; retryable failures are requeued with backoff', {
          security: workerSecurity,
          requestBody: jsonBody('WorkerFailRequest'),
          responses: {
            200: okResponse('WorkerFailResponse'),
            ...WORKER_ERRORS,
            409: errorResponse('LEASE_LOST'),
          },
        }),
      },
    },
    components: {
      securitySchemes: { workerToken: { type: 'http', scheme: 'bearer' } },
      schemas: Object.fromEntries(Object.entries(COMPONENTS).map(([name, s]) => [name, schema(s)])),
    },
  };
}
