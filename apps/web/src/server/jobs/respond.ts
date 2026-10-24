import 'server-only';
import type { GenerationJobView } from '@chordflow/chart-schema';
import type { Database } from '../db/client';
import type { JobUser } from './service';
import { isWorkerAvailable } from './store';
import { toJobView, type JobRow } from './views';

/** Job views for one response; worker presence is looked up once. */
export async function jobViews(
  db: Database,
  rows: readonly JobRow[],
  user: JobUser,
): Promise<GenerationJobView[]> {
  const workerAvailable = await isWorkerAvailable(db);
  return rows.map((row) => toJobView(row, { isAdmin: user.role === 'admin', workerAvailable }));
}

export async function jobView(
  db: Database,
  row: JobRow,
  user: JobUser,
): Promise<GenerationJobView> {
  const [view] = await jobViews(db, [row], user);
  if (!view) throw new Error('unreachable');
  return view;
}
