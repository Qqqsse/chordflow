import type { ChartLine, ChartSection, SectionKind } from '@chordflow/chart-schema';
import { segmentLine } from '@/lib/line-segments';

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

function ChordLine({ line }: { line: ChartLine }) {
  const { unanchored, segments } = segmentLine(line.text, line.chords);
  return (
    <div className="flex flex-wrap items-end" data-line-id={line.id}>
      {unanchored.map((chord) => (
        <span key={chord.id} data-chord-id={chord.id} className="mr-4 font-semibold text-accent">
          {chord.symbol}
        </span>
      ))}
      {segments.map((segment, index) => (
        <span
          key={segment.chordId ?? `text-${index}`}
          className="inline-flex flex-col"
          data-chord-id={segment.chordId ?? undefined}
        >
          <span className="min-h-[1.5em] pr-2 font-semibold text-accent">
            {segment.chord ?? ''}
          </span>
          <span className="whitespace-pre text-lg">{segment.text}</span>
        </span>
      ))}
    </div>
  );
}

export function ChartPreview({ sections }: { sections: readonly ChartSection[] }) {
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.id} aria-label={sectionLabel(section)} className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            {sectionLabel(section)}
          </h2>
          {section.lines.map((line) => (
            <ChordLine key={line.id} line={line} />
          ))}
        </section>
      ))}
    </div>
  );
}
