import type { ChordAst } from '@chordflow/music-theory';
import { voicingLibrary } from './library';
import { STANDARD_TUNING, type Tuning } from './tuning';
import {
  validateVoicing,
  type Voicing,
  type VoicingCheck,
  type VoicingDifficulty,
} from './voicing';

/*
 * Deterministic, configurable scoring (SPEC §7). Harmonic correctness is a
 * hard constraint (only validated voicings are ranked); then barre,
 * stretch, position, inner muted strings and finger count add cost.
 */

export interface ScoreWeights {
  fullBarre: number;
  partialBarre: number;
  perExtraFretOfSpan: number;
  highPosition: number;
  veryHighPosition: number;
  innerMutedString: number;
  fourFingers: number;
  aboveDifficultyPerLevel: number;
  transitionPerFret: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  fullBarre: 3,
  partialBarre: 2,
  perExtraFretOfSpan: 1,
  highPosition: 1,
  veryHighPosition: 2,
  innerMutedString: 1,
  fourFingers: 1,
  aboveDifficultyPerLevel: 5,
  transitionPerFret: 0.5,
};

const LEVELS: readonly VoicingDifficulty[] = ['easy', 'intermediate', 'advanced'];

export function difficultyScore(voicing: Voicing, weights: ScoreWeights = DEFAULT_WEIGHTS): number {
  const { frets, barres, fingers } = voicing;
  let score = 0;
  for (const barre of barres) {
    score += barre.toString - barre.fromString >= 5 ? weights.fullBarre : weights.partialBarre;
  }
  const fretted = frets.filter((f) => f > 0);
  if (fretted.length > 0) {
    const span = Math.max(...fretted) - Math.min(...fretted) + 1;
    score += Math.max(0, span - 3) * weights.perExtraFretOfSpan;
    const lowest = Math.min(...fretted);
    if (lowest >= 9) score += weights.veryHighPosition;
    else if (lowest >= 5) score += weights.highPosition;
  }
  const first = frets.findIndex((f) => f >= 0);
  const last = frets.length - 1 - [...frets].reverse().findIndex((f) => f >= 0);
  for (let i = first + 1; i < last; i += 1) if (frets[i] === -1) score += weights.innerMutedString;
  const fingerCount = fingers ? new Set(fingers.filter((f) => f !== null)).size : fretted.length;
  if (fingerCount >= 4) score += weights.fourFingers;
  return score;
}

export function difficultyOf(
  voicing: Voicing,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): VoicingDifficulty {
  if (voicing.difficulty !== null) return voicing.difficulty;
  const score = difficultyScore(voicing, weights);
  return score <= 1 ? 'easy' : score <= 3 ? 'intermediate' : 'advanced';
}

function position(voicing: Voicing): number {
  const fretted = voicing.frets.filter((f) => f > 0);
  return fretted.length === 0 ? 0 : fretted.reduce((a, b) => a + b, 0) / fretted.length;
}

export interface RankedVoicing {
  voicing: Voicing;
  difficulty: VoicingDifficulty;
  score: number;
  check: VoicingCheck;
}

export interface RecommendOptions {
  tuning?: Tuning;
  preferredDifficulty?: VoicingDifficulty;
  /** Previous chord's voicing, for transition cost. */
  previous?: Voicing | null;
  weights?: ScoreWeights;
}

export type RecommendResult =
  | { status: 'ok'; ranked: RankedVoicing[] }
  | { status: 'unsupported'; reason: 'NO_VERIFIED_VOICING'; ranked: [] };

/** Every library voicing that validates for `chord` in `tuning`. */
export function findVoicings(
  chord: ChordAst,
  tuning: Tuning = STANDARD_TUNING,
): { voicing: Voicing; check: VoicingCheck }[] {
  return voicingLibrary()
    .map((voicing) => ({ voicing, check: validateVoicing(voicing, chord, tuning) }))
    .filter((entry) => entry.check.valid);
}

export function recommendVoicings(
  chord: ChordAst,
  options: RecommendOptions = {},
): RecommendResult {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const preferred = LEVELS.indexOf(options.preferredDifficulty ?? 'easy');
  const ranked = findVoicings(chord, options.tuning ?? STANDARD_TUNING).map(
    ({ voicing, check }) => {
      const difficulty = difficultyOf(voicing, weights);
      let score = difficultyScore(voicing, weights);
      score +=
        Math.max(0, LEVELS.indexOf(difficulty) - preferred) * weights.aboveDifficultyPerLevel;
      if (options.previous)
        score +=
          Math.abs(position(voicing) - position(options.previous)) * weights.transitionPerFret;
      return { voicing, difficulty, score, check };
    },
  );
  if (ranked.length === 0)
    return { status: 'unsupported', reason: 'NO_VERIFIED_VOICING', ranked: [] };
  ranked.sort(
    (a, b) =>
      a.score - b.score ||
      Number(a.voicing.source !== 'curated') - Number(b.voicing.source !== 'curated') ||
      position(a.voicing) - position(b.voicing) ||
      a.voicing.id.localeCompare(b.voicing.id),
  );
  return { status: 'ok', ranked };
}

export interface VoicingPolicyLike {
  symbolDefaults?: Readonly<Record<string, string>>;
  occurrenceOverrides: Readonly<Record<string, string>>;
}

export interface ResolvedVoicing {
  ranked: RankedVoicing[];
  selected: RankedVoicing | null;
  source: 'user' | 'occurrence' | 'arrangement' | 'recommended' | 'none';
  /** Override ids that were present but do not realize this chord (ignored, never forced). */
  ignored: string[];
}

/**
 * Picks the voicing to show for one chord occurrence: user choice, then the
 * chart's occurrence override, then its per-symbol default, then the top
 * recommendation. Invalid references are reported and skipped.
 */
export function resolveVoicing(
  chord: ChordAst,
  occurrenceId: string,
  symbol: string,
  policy: VoicingPolicyLike,
  options: RecommendOptions & { userChoice?: string | null } = {},
): ResolvedVoicing {
  const result = recommendVoicings(chord, options);
  const ranked = result.ranked;
  const ignored: string[] = [];
  const pick = (id: string | null | undefined) => {
    if (id === null || id === undefined) return null;
    const found = ranked.find((r) => r.voicing.id === id) ?? null;
    if (found === null) ignored.push(id);
    return found;
  };
  const candidates: [ResolvedVoicing['source'], string | null | undefined][] = [
    ['user', options.userChoice],
    ['occurrence', policy.occurrenceOverrides[occurrenceId]],
    ['arrangement', policy.symbolDefaults?.[symbol]],
  ];
  for (const [source, id] of candidates) {
    const found = pick(id);
    if (found) return { ranked, selected: found, source, ignored };
  }
  const top = ranked[0] ?? null;
  return { ranked, selected: top, source: top ? 'recommended' : 'none', ignored };
}
