import type { CompatibilityProvenance } from '@chordflow/chart-schema';

export const RECORDING_KIND_LABEL: Readonly<Record<string, string>> = {
  studio: '錄音室版',
  live: '現場版',
  cover: '翻唱',
  acoustic: '不插電',
  unknown: '版本不明',
};

export const VARIANT_LABEL: Readonly<Record<string, string>> = {
  original: '原版',
  simplified: '簡化版',
  capo_friendly: '移調夾友善',
  other: '其他',
};

export const PROVENANCE_LABEL: Readonly<Record<CompatibilityProvenance, string>> = {
  exact_audio_match: '音訊比對相符',
  human_verified: '已人工確認',
  suggested: '建議（未驗證）',
  unknown: '對應未確認',
};

export const ROLE_LABEL: Readonly<Record<string, string>> = {
  original_artist: '原唱',
  lyricist: '詞',
  composer: '曲',
  arranger: '編',
};
