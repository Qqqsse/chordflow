import { splitGraphemes, type ChartChange, type DiffableChart } from '@chordflow/chart-schema';
import { sectionLabel } from '@/components/section-label';

/* zh-TW descriptions of review diff entries (see diffCharts in @chordflow/chart-schema). */

const FIELD_LABEL: Readonly<Record<string, string>> = {
  title: '歌名',
  language: '語言',
  concertKey: '調性',
  timeSignature: '拍號',
  defaultBpm: '速度',
};

const show = (value: string | number | null) => (value === null ? '（無）' : String(value));

function sectionName(chart: DiffableChart, index: number): string {
  const section = chart.sections[index];
  if (section === undefined) return `第 ${String(index + 1)} 段`;
  const sameKind = chart.sections.slice(0, index + 1).filter((s) => s.kind === section.kind);
  const total = chart.sections.filter((s) => s.kind === section.kind).length;
  return `${sectionLabel(section)}${total > 1 ? ` ${String(sameKind.length)}` : ''}`;
}

function lineName(chart: DiffableChart, [s, l]: [number, number]): string {
  return `${sectionName(chart, s)} 第 ${String(l + 1)} 行`;
}

/** Where a chord sits: before which character (「吹」前), 行首／行尾, or off the lyrics. */
export function positionText(
  chart: DiffableChart,
  [s, l]: [number, number],
  offset: number | null,
) {
  if (offset === null) return '不在歌詞上';
  const text = chart.sections[s]?.lines[l]?.text ?? '';
  const graphemes = splitGraphemes(text);
  const at = graphemes[offset];
  return at === undefined || at.trim() === '' ? (offset === 0 ? '行首' : '行尾') : `「${at}」前`;
}

export function describeChange(
  change: ChartChange,
  before: DiffableChart,
  after: DiffableChart,
): string {
  switch (change.kind) {
    case 'metadata_changed':
      return `${FIELD_LABEL[change.field] ?? change.field}：${show(change.from)} → ${show(change.to)}`;
    case 'section_added':
      return `新增段落：${sectionName(after, change.path[0])}（${String(change.lines)} 行）`;
    case 'section_removed':
      return `刪除段落：${sectionName(before, change.path[0])}（${String(change.lines)} 行）`;
    case 'section_changed':
      return `段落類型：${sectionLabel({ kind: change.from.sectionKind, label: change.from.label ?? undefined })} → ${sectionName(after, change.path[0])}`;
    case 'line_added':
      return `${lineName(after, change.path)}：新增歌詞「${change.text}」`;
    case 'line_removed':
      return `${lineName(before, change.path)}：刪除歌詞「${change.text}」`;
    case 'lyrics_changed':
      return `${lineName(after, change.path)}：歌詞「${change.from}」→「${change.to}」`;
    case 'chord_changed':
      return `${lineName(after, change.path)}：${change.from} → ${change.to}（${positionText(after, change.path, change.offset)}）`;
    case 'chord_added':
      return `${lineName(after, change.path)}：新增和弦 ${change.symbol}（${positionText(after, change.path, change.offset)}）`;
    case 'chord_removed':
      return `${lineName(after, change.path)}：刪除和弦 ${change.symbol}（原本在${positionText(before, nearest(before, change.path), change.offset)}）`;
    case 'chord_moved':
      return `${lineName(after, change.path)}：${change.symbol} 從${positionText(after, change.path, change.fromOffset)}移到${positionText(after, change.path, change.toOffset)}`;
  }
}

/** Removed chords carry the after-path of their line; fall back if that line is missing before. */
function nearest(chart: DiffableChart, path: [number, number]): [number, number] {
  return chart.sections[path[0]]?.lines[path[1]] === undefined ? [0, 0] : path;
}
