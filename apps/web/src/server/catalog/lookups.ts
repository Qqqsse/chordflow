import { OpaqueIdSchema, type Arrangement } from '@chordflow/chart-schema';
import { ApiProblem } from '@/lib/api/handler';
import type { Principal } from '../access';
import type { CatalogRepository } from './repository';
import { visibleArrangement } from './views';

export function requireId(
  value: string,
  notFound:
    | 'WORK_NOT_FOUND'
    | 'RECORDING_NOT_FOUND'
    | 'ARRANGEMENT_NOT_FOUND'
    | 'CHART_NOT_FOUND'
    | 'JOB_NOT_FOUND'
    | 'UPLOAD_NOT_FOUND',
): string {
  if (!OpaqueIdSchema.safeParse(value).success) throw new ApiProblem(404, notFound, 'Not found');
  return value;
}

/** Arrangement the principal may see; hidden and missing look identical (404). */
export async function requireVisibleArrangement(
  repo: CatalogRepository,
  principal: Principal,
  id: string,
): Promise<Arrangement> {
  const arrangement = await repo.getArrangement(requireId(id, 'ARRANGEMENT_NOT_FOUND'));
  if (arrangement === null || !(await visibleArrangement(repo, principal, arrangement))) {
    throw new ApiProblem(404, 'ARRANGEMENT_NOT_FOUND', 'Arrangement was not found');
  }
  return arrangement;
}
