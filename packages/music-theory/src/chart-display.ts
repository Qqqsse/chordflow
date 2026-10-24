import { formatChord, parseChord, type ChordAst } from './chord';
import { formatKey, parseKey, transposeKey, type KeyContext } from './key';
import { renderNashvilleNumber, renderRomanNumeral, type NumberedChord } from './numbering';
import { transposeChord, assertCapo } from './transpose';
import type { AccidentalStyle } from './pitch';

/*
 * Pure display transformation for a whole chart (SPEC §5, §4 invariants):
 * transpose / capo / notation change only the returned view, never the input.
 * The input type is structural so this package needs no schema dependency.
 */

export interface ChartLike {
  concertKey: string | null;
  sections: readonly {
    lines: readonly { chords: readonly { id: string; symbol: string }[] }[];
  }[];
}

export type ChordNotation = 'letters' | 'roman' | 'nashville';
/** Which chord name the player reads: the capo shape to finger, or the sounding chord. */
export type ChordDisplayTarget = 'shape' | 'sounding';

export interface ChartDisplayOptions {
  /** Change of sounding pitch relative to the concert chart. */
  transposeSemitones: number;
  capoFret: number;
  show: ChordDisplayTarget;
  notation: ChordNotation;
  accidentals?: AccidentalStyle;
}

export type NumberingUnavailableReason = 'KEY_UNKNOWN' | 'KEY_INVALID';

export interface DisplayChord {
  id: string;
  original: string;
  status: 'ok' | 'unsupported';
  /** Text to render. Unsupported chords fall back to the original symbol, unchanged. */
  display: string;
  /** Present when `status` is `ok`. */
  sounding?: string;
  shape?: string;
  numbered?: NumberedChord | null;
  unsupportedReason?: string;
}

export interface ChartDisplay {
  keys: { concert: string | null; sounding: string | null; shape: string | null };
  numbering: { available: true } | { available: false; reason: NumberingUnavailableReason };
  chords: Record<string, DisplayChord>;
}

export function transposeChartDisplay(
  chart: ChartLike,
  options: ChartDisplayOptions,
): ChartDisplay {
  if (!Number.isInteger(options.transposeSemitones)) {
    throw new RangeError('transposeSemitones must be an integer');
  }
  assertCapo(options.capoFret);
  const style = options.accidentals ?? 'ascii';

  const concertKey: KeyContext | null =
    chart.concertKey === null ? null : parseKey(chart.concertKey);
  const keyInvalid = chart.concertKey !== null && concertKey === null;
  const soundingKey = concertKey ? transposeKey(concertKey, options.transposeSemitones).key : null;
  const shapeKey = soundingKey ? transposeKey(soundingKey, -options.capoFret).key : null;

  const numbering: ChartDisplay['numbering'] =
    concertKey !== null
      ? { available: true }
      : { available: false, reason: keyInvalid ? 'KEY_INVALID' : 'KEY_UNKNOWN' };

  const render = (concert: ChordAst): DisplayChord => {
    const sounding = transposeChord(concert, options.transposeSemitones, { key: concertKey });
    const shape = transposeChord(sounding, -options.capoFret, { key: soundingKey });
    let numbered: NumberedChord | null = null;
    if (concertKey !== null && options.notation !== 'letters') {
      numbered =
        options.notation === 'roman'
          ? renderRomanNumeral(concert, concertKey)
          : renderNashvilleNumber(concert, concertKey);
    }
    const soundingText = formatChord(sounding, style);
    const shapeText = formatChord(shape, style);
    const letters = options.show === 'shape' ? shapeText : soundingText;
    return {
      id: '',
      original: concert.input,
      status: 'ok',
      display: options.notation === 'letters' || numbered === null ? letters : numbered.text,
      sounding: soundingText,
      shape: shapeText,
      numbered,
    };
  };

  const chords: Record<string, DisplayChord> = {};
  for (const section of chart.sections) {
    for (const line of section.lines) {
      for (const chord of line.chords) {
        const parsed = parseChord(chord.symbol);
        chords[chord.id] = parsed.ok
          ? { ...render(parsed.chord), id: chord.id }
          : {
              id: chord.id,
              original: chord.symbol,
              status: 'unsupported',
              display: chord.symbol,
              unsupportedReason: parsed.error.code,
            };
      }
    }
  }

  return {
    keys: {
      concert: concertKey ? formatKey(concertKey, style) : chart.concertKey,
      sounding: soundingKey ? formatKey(soundingKey, style) : null,
      shape: shapeKey ? formatKey(shapeKey, style) : null,
    },
    numbering,
    chords,
  };
}

export type CapoMode = 'keep_pitch' | 'keep_shape';

export interface CapoState {
  transposeSemitones: number;
  capoFret: number;
}

/**
 * Applies a capo change explicitly in one of two modes (never mixed):
 * `keep_pitch` keeps the sounding key (shapes change); `keep_shape` keeps the
 * fingered shapes (sounding pitch moves with the capo).
 */
export function changeCapo(state: CapoState, capoFret: number, mode: CapoMode): CapoState {
  assertCapo(capoFret);
  if (mode === 'keep_pitch') return { ...state, capoFret };
  return {
    capoFret,
    transposeSemitones: state.transposeSemitones + (capoFret - state.capoFret),
  };
}
