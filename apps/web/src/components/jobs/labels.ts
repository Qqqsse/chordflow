import type {
  ExternalJobStatus,
  JobErrorCode,
  PipelineStage,
  QualitySpan,
} from '@chordflow/chart-schema';

export const JOB_STATUS_LABEL: Readonly<Record<ExternalJobStatus, string>> = {
  not_available: '無法使用',
  queued: '排隊中',
  waiting_for_worker: '等待 worker（目前沒有 worker 在線）',
  processing: '處理中',
  needs_review: '待審查',
  completed: '已發布',
  failed: '失敗',
  cancelled: '已取消',
};

export const STAGE_LABEL: Readonly<Record<PipelineStage, string>> = {
  resolve_source: '確認來源與權利',
  decode_and_probe_audio: '音訊解碼',
  chord_recognition: '和弦辨識',
  lyric_alignment: '歌詞對齊',
  fusion: '合併和弦與歌詞',
  rule_validator: '規則檢查',
  llm_reviewer: '審查建議',
  draft_producer: '產生草稿',
};

export const JOB_ERROR_LABEL: Readonly<Record<JobErrorCode, string>> = {
  SOURCE_NOT_AUTHORIZED: '來源未授權分析',
  SOURCE_UNSUPPORTED: '不支援的輸入',
  AUDIO_NOT_AVAILABLE: '沒有可分析的授權音訊',
  AUDIO_INVALID: '音訊格式無效',
  AUDIO_TOO_LONG: '音訊太長',
  ALIGNMENT_LOW_CONFIDENCE: '歌詞對齊可信度太低',
  MODEL_UNAVAILABLE: '模型暫時無法使用',
  ARTIFACT_VALIDATION_FAILED: '產出未通過驗證',
  LEASE_EXPIRED: 'worker 未按時回報，已重新排隊',
  RETRY_LIMIT_EXCEEDED: '重試次數已用完',
  LLM_BUDGET_EXCEEDED: '審查呼叫已達上限',
  INTERNAL_ERROR: 'worker 發生錯誤',
};

export const SPAN_REASON_LABEL: Readonly<Record<QualitySpan['reason'], string>> = {
  unaligned: '未對齊',
  low_confidence: '可信度低',
  non_diatonic: '非順階和弦',
  ambiguous_section: '段落不確定',
  synthetic_output: '合成輸出',
};

/** Statuses where the job may still change on its own (keep polling). */
export const LIVE_STATUSES: ReadonlySet<ExternalJobStatus> = new Set([
  'queued',
  'waiting_for_worker',
  'processing',
]);
