import type { ChartDocument, ChartSection } from '@chordflow/chart-schema';
import type { ChartDisplay } from '@chordflow/music-theory';
import type { ReactNode } from 'react';
import { sectionLabel } from '@/components/section-label';
import { ChordLabel } from './chord-label';
import { layoutLine, type LineLayout, type LineUnit } from './line-layout';

function Unit({ unit, display }: { unit: LineUnit; display: ChartDisplay }): ReactNode {
  switch (unit.kind) {
    case 'text':
      return <span className="lyric">{unit.text}</span>;
    case 'chord':
      return (
        <span className="anchor" data-chord-id={unit.chordId}>
          <ChordLabel chord={display.chords[unit.chordId]} />
          <span className="lyric">{unit.text === '' ? '\u00a0' : unit.text}</span>
        </span>
      );
    case 'glue':
      return (
        <span className="glue">
          {unit.items.map((item) => (
            <Unit key={item.key} unit={item} display={display} />
          ))}
        </span>
      );
  }
}

function Line({ layout, display }: { layout: LineLayout; display: ChartDisplay }) {
  if (layout.kind === 'blank') {
    return <div className="sheet-blank" data-line-id={layout.lineId} aria-hidden="true" />;
  }
  if (layout.kind === 'chords-only') {
    return (
      <p className="sheet-line sheet-chords-only" data-line-id={layout.lineId}>
        {layout.chordIds.map((id) => (
          <span key={id} className="chord-only" data-chord-id={id}>
            <ChordLabel chord={display.chords[id]} />
          </span>
        ))}
      </p>
    );
  }
  return (
    <p className="sheet-line" data-line-id={layout.lineId}>
      {layout.leadingChordIds.map((id) => (
        <span key={id} className="anchor" data-chord-id={id}>
          <ChordLabel chord={display.chords[id]} />
          <span className="lyric">{'\u00a0'}</span>
        </span>
      ))}
      {layout.units.map((unit) => (
        <Unit key={unit.key} unit={unit} display={display} />
      ))}
    </p>
  );
}

function Section({ section, display }: { section: ChartSection; display: ChartDisplay }) {
  const label = sectionLabel(section);
  return (
    <section className="sheet-section" aria-label={label} data-section-id={section.id}>
      <h2 className="sheet-section-label">{label}</h2>
      {section.lines.map((line) => (
        <Line key={line.id} layout={layoutLine(line)} display={display} />
      ))}
    </section>
  );
}

/** Static chord sheet for a chart and a precomputed display view. */
export function ChordSheet({
  chart,
  display,
  fontSize,
}: {
  chart: ChartDocument;
  display: ChartDisplay;
  fontSize: number;
}) {
  return (
    <div
      className="chord-sheet"
      style={{ fontSize: `${fontSize}px` }}
      lang={chart.language}
      data-testid="chord-sheet"
    >
      {chart.sections.map((section) => (
        <Section key={section.id} section={section} display={display} />
      ))}
    </div>
  );
}
