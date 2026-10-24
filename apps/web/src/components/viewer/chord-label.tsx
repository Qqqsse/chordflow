import type { DisplayChord } from '@chordflow/music-theory';

/** One chord label. Numbered chords render their suffix as a superscript. */
export function ChordLabel({ chord }: { chord: DisplayChord | undefined }) {
  if (chord === undefined) return null;
  if (chord.status === 'unsupported') {
    return (
      <span
        className="chord-label chord-unsupported"
        title="無法解析此和弦，依原樣顯示"
        data-unsupported="true"
      >
        {chord.display}
      </span>
    );
  }
  const n = chord.numbered ?? null;
  if (n?.text !== chord.display) {
    return <span className="chord-label">{chord.display}</span>;
  }
  return (
    <span className="chord-label" aria-label={n.text}>
      {n.accidental}
      {n.numeral}
      {n.quality}
      {n.suffix !== '' && <sup>{n.suffix}</sup>}
      {n.bass !== null && `/${n.bass}`}
    </span>
  );
}
