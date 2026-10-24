import type {
  Arrangement,
  ArrangementRecordingCompatibility,
  Artist,
  ChartRevision,
  RecordingSync,
  Recording,
  SourceReference,
  Work,
} from '@chordflow/chart-schema';

/**
 * Read-side catalog port. Implemented by the in-memory demo adapter now and
 * by the PostgreSQL adapter in M6. Returned objects are copies: callers can
 * never mutate stored revisions.
 */
export interface CatalogRepository {
  getArtist(id: string): Promise<Artist | null>;
  getWork(id: string): Promise<Work | null>;
  getRecording(id: string): Promise<Recording | null>;
  listRecordingsForWork(workId: string): Promise<Recording[]>;
  getArrangement(id: string): Promise<Arrangement | null>;
  listArrangementsForWork(workId: string): Promise<Arrangement[]>;
  listCompatibilities(filter: {
    arrangementId?: string;
    recordingId?: string;
  }): Promise<ArrangementRecordingCompatibility[]>;
  getRevision(arrangementId: string, revision: number): Promise<ChartRevision | null>;
  getRevisionById(id: string): Promise<ChartRevision | null>;
  listRevisions(arrangementId: string): Promise<ChartRevision[]>;
  /** The arrangement's published revision, or `null` when nothing is published. */
  getPublishedRevision(arrangementId: string): Promise<ChartRevision | null>;
  getRecordingSync(recordingId: string, chartRevisionId: string): Promise<RecordingSync | null>;
  getSource(id: string): Promise<SourceReference | null>;
  /**
   * Works whose normalized title, aliases or artist names contain the
   * normalized query (adapters may add fuzzy matches after exact ones).
   * Ordered by match position, then title, then id.
   */
  searchWorks(
    normalizedQuery: string,
    page: { limit: number; offset: number },
  ): Promise<{
    works: Work[];
    hasMore: boolean;
  }>;
}
