import { diagramGeometry, fretsToken, type Voicing } from '@chordflow/guitar-voicings';

/**
 * SVG chord diagram drawn from validated voicing data. All text goes through
 * React (escaped); no markup is injected.
 */
export function ChordDiagram({ symbol, voicing }: { symbol: string; voicing: Voicing }) {
  const g = diagramGeometry(voicing);
  const description = `${symbol} 指法 ${fretsToken(voicing.frets)}（由低音弦到高音弦，x 為不彈）`;
  return (
    <svg
      viewBox={`0 0 ${g.width} ${g.height}`}
      className="chord-diagram"
      role="img"
      aria-label={description}
      data-voicing-id={voicing.id}
    >
      <title>{description}</title>
      <g stroke="currentColor" strokeWidth={0.8}>
        {g.strings.map((l, i) => (
          <line key={`s${i}`} {...l} />
        ))}
        {g.frets.map((l, i) => (
          <line key={`f${i}`} {...l} />
        ))}
        {g.nut && <line {...g.nut} strokeWidth={2.4} />}
      </g>
      {g.barres.map((b) => (
        <rect
          key={`b${b.fret}`}
          x={b.x}
          y={b.y}
          width={b.width}
          height={b.height}
          rx={b.rx}
          className="diagram-dot"
        />
      ))}
      {g.dots.map((d) => (
        <g key={`d${d.string}`}>
          <circle cx={d.cx} cy={d.cy} r={d.r} className="diagram-dot" />
          {d.finger !== null && (
            <text
              x={d.cx}
              y={d.cy}
              className="diagram-finger"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {d.finger}
            </text>
          )}
        </g>
      ))}
      {g.markers.map((m) =>
        m.kind === 'open' ? (
          <circle
            key={`m${m.string}`}
            cx={m.cx}
            cy={m.cy}
            r={3}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.9}
          />
        ) : (
          <text
            key={`m${m.string}`}
            x={m.cx}
            y={m.cy}
            textAnchor="middle"
            dominantBaseline="central"
            className="diagram-mark"
          >
            ×
          </text>
        ),
      )}
      {g.baseFretLabel && (
        <text
          x={g.baseFretLabel.x}
          y={g.baseFretLabel.y}
          dominantBaseline="central"
          className="diagram-mark"
        >
          {g.baseFretLabel.text}
        </text>
      )}
    </svg>
  );
}
