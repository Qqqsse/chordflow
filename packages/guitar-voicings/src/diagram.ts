import type { Voicing } from './voicing';

/*
 * Pure chord-diagram geometry (SPEC §7). Renderers draw these primitives as
 * SVG elements; no SVG markup is generated or stored, and chord text is
 * never injected as HTML. Coordinates are in an abstract viewBox.
 */

export interface DiagramOptions {
  /** Number of fret spaces drawn (default 4). */
  fretCount?: number;
  stringSpacing?: number;
  fretSpacing?: number;
  marginLeft?: number;
  marginTop?: number;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Dot {
  string: number;
  fret: number;
  cx: number;
  cy: number;
  r: number;
  finger: string | null;
}

export interface BarreRect {
  fret: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

export interface StringMarker {
  string: number;
  kind: 'open' | 'muted';
  cx: number;
  cy: number;
}

export interface DiagramGeometry {
  width: number;
  height: number;
  /** First fret shown; 1 means the nut is drawn. */
  baseFret: number;
  showNut: boolean;
  nut: Line | null;
  strings: Line[];
  frets: Line[];
  dots: Dot[];
  barres: BarreRect[];
  markers: StringMarker[];
  /** Position label like `5fr`, drawn beside the first fret when baseFret > 1. */
  baseFretLabel: { text: string; x: number; y: number } | null;
}

/** Lowest fret window that shows every fretted note within `fretCount` spaces. */
export function baseFretFor(voicing: Pick<Voicing, 'frets'>, fretCount = 4): number {
  const fretted = voicing.frets.filter((f) => f > 0);
  if (fretted.length === 0) return 1;
  const max = Math.max(...fretted);
  return max <= fretCount ? 1 : Math.min(...fretted);
}

export function diagramGeometry(
  voicing: Pick<Voicing, 'frets' | 'fingers' | 'barres'>,
  options: DiagramOptions = {},
): DiagramGeometry {
  const fretCount = options.fretCount ?? 4;
  const sx = options.stringSpacing ?? 12;
  const fy = options.fretSpacing ?? 14;
  const left = options.marginLeft ?? 14;
  const top = options.marginTop ?? 16;
  const strings = voicing.frets.length;
  const gridWidth = sx * (strings - 1);
  const gridHeight = fy * fretCount;
  const baseFret = baseFretFor(voicing, fretCount);
  const showNut = baseFret === 1;

  const xOf = (string: number) => left + string * sx;
  /** Center of the fret space for absolute fret `fret`. */
  const yOf = (fret: number) => top + (fret - baseFret + 0.5) * fy;

  const stringLines: Line[] = Array.from({ length: strings }, (_, s) => ({
    x1: xOf(s),
    y1: top,
    x2: xOf(s),
    y2: top + gridHeight,
  }));
  const fretLines: Line[] = Array.from({ length: fretCount + 1 }, (_, i) => ({
    x1: left,
    y1: top + i * fy,
    x2: left + gridWidth,
    y2: top + i * fy,
  }));

  const barres: BarreRect[] = voicing.barres.map((b) => ({
    fret: b.fret,
    x: xOf(b.fromString) - sx * 0.35,
    y: yOf(b.fret) - fy * 0.3,
    width: xOf(b.toString) - xOf(b.fromString) + sx * 0.7,
    height: fy * 0.6,
    rx: fy * 0.3,
  }));
  const barred = (string: number, fret: number) =>
    voicing.barres.some((b) => b.fret === fret && string >= b.fromString && string <= b.toString);

  const dots: Dot[] = [];
  const markers: StringMarker[] = [];
  voicing.frets.forEach((fret, s) => {
    if (fret < 0) markers.push({ string: s, kind: 'muted', cx: xOf(s), cy: top - 7 });
    else if (fret === 0) markers.push({ string: s, kind: 'open', cx: xOf(s), cy: top - 7 });
    else if (!barred(s, fret)) {
      const finger = voicing.fingers?.[s] ?? null;
      dots.push({
        string: s,
        fret,
        cx: xOf(s),
        cy: yOf(fret),
        r: sx * 0.38,
        finger: finger === null ? null : String(finger),
      });
    }
  });

  return {
    width: left + gridWidth + 16,
    height: top + gridHeight + 6,
    baseFret,
    showNut,
    nut: showNut ? { x1: left, y1: top, x2: left + gridWidth, y2: top } : null,
    strings: stringLines,
    frets: fretLines,
    dots,
    barres,
    markers,
    baseFretLabel: showNut
      ? null
      : { text: `${baseFret}fr`, x: left + gridWidth + 4, y: top + fy * 0.5 },
  };
}
