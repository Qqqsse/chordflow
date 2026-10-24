import 'server-only';
import snapshot from '../../../../../fixtures/contracts/catalog-demo.json';
import { DEMO_FIXTURE_FILES } from './demo-catalog-files';
import { createMemoryCatalog } from './memory-repository';
import type { CatalogRepository } from './repository';

export { DEMO_FIXTURE_FILES };

let cached: CatalogRepository | undefined;

export function getDemoCatalog(): CatalogRepository {
  cached ??= createMemoryCatalog(snapshot, DEMO_FIXTURE_FILES);
  return cached;
}
