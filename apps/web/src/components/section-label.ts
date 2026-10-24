import type { ChartSection, SectionKind } from '@chordflow/chart-schema';

const SECTION_LABELS: Readonly<Record<SectionKind, string>> = {
  intro: '前奏',
  verse: '主歌',
  pre_chorus: '導歌',
  chorus: '副歌',
  bridge: '橋段',
  instrumental: '間奏',
  interlude: '過門',
  outro: '尾奏',
  tag: '尾段',
  other: '段落',
};

export function sectionLabel(section: Pick<ChartSection, 'kind' | 'label'>): string {
  return section.label ?? SECTION_LABELS[section.kind];
}
