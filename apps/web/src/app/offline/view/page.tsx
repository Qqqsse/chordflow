import type { Metadata } from 'next';
import { OfflineChart } from '@/components/offline/offline-chart';

export const metadata: Metadata = { title: '離線譜' };

export default function OfflineChartPage() {
  return <OfflineChart />;
}
