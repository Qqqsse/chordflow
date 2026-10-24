import 'server-only';
import syncLive from '../../../../../fixtures/ai/demo-basic.live.sync.json';
import syncStudio from '../../../../../fixtures/ai/demo-basic.studio.sync.json';
import chartBasic from '../../../../../fixtures/charts/demo-basic.chart.json';
import chartEnglish from '../../../../../fixtures/charts/demo-english.chart.json';
import chartFullZh from '../../../../../fixtures/charts/demo-full-zh.chart.json';
import chartAmazingGrace from '../../../../../fixtures/charts/pd-amazing-grace.chart.json';
import chartSongbie from '../../../../../fixtures/charts/pd-songbie.chart.json';
import snapshot from '../../../../../fixtures/contracts/catalog-demo.json';
import { createMemoryCatalog, type FixtureFiles } from './memory-repository';
import type { CatalogRepository } from './repository';

/** Synthetic and public-domain demo content bundled into the server build (no filesystem access at runtime). */
export const DEMO_FIXTURE_FILES: FixtureFiles = {
  'charts/demo-basic.chart.json': chartBasic,
  'charts/demo-english.chart.json': chartEnglish,
  'charts/demo-full-zh.chart.json': chartFullZh,
  'charts/pd-songbie.chart.json': chartSongbie,
  'charts/pd-amazing-grace.chart.json': chartAmazingGrace,
  'ai/demo-basic.studio.sync.json': syncStudio,
  'ai/demo-basic.live.sync.json': syncLive,
};

let cached: CatalogRepository | undefined;

export function getDemoCatalog(): CatalogRepository {
  cached ??= createMemoryCatalog(snapshot, DEMO_FIXTURE_FILES);
  return cached;
}
