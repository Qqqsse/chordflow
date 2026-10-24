import { ApiProblem } from '@/lib/api/handler';
import { EditorError } from './editor';

/** Maps editor failures to API problems; rethrows anything else. */
export function toApiProblem(error: unknown): never {
  if (error instanceof EditorError) {
    const details = error.issues.length > 0 ? { issues: error.issues } : null;
    switch (error.code) {
      case 'NOT_FOUND':
        throw new ApiProblem(404, 'ARRANGEMENT_NOT_FOUND', error.message);
      case 'CONFLICT':
        throw new ApiProblem(409, 'REVISION_CONFLICT', error.message);
      case 'INVALID':
        throw new ApiProblem(422, 'VALIDATION_FAILED', error.message, details);
      case 'PUBLISH_REJECTED':
        throw new ApiProblem(422, 'PUBLISH_REJECTED', error.message, details);
    }
  }
  throw error;
}
