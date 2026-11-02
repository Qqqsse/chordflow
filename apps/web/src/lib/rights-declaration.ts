/**
 * Rights texts for audio uploads (docs/audio-sources.md). The server records
 * which upload declaration version, and the SHA-256 of its exact text, each
 * uploader agreed to: change the wording by adding a new version, never by
 * editing an existing one.
 */

export const UPLOAD_DECLARATIONS = {
  'audio-upload-v1':
    '我確認這份音訊是我自己錄製的，或我已取得權利人的授權，可以用來產生和弦譜草稿。我了解這份音訊只會用於產生我的和弦譜草稿、不會公開，並會在保留期限到期後自動刪除。上傳內容的合法性由我自行負責。',
} as const;

export type UploadDeclarationVersion = keyof typeof UPLOAD_DECLARATIONS;

/** The version shown to uploaders now; uploads must agree to exactly this one. */
export const CURRENT_UPLOAD_DECLARATION: UploadDeclarationVersion = 'audio-upload-v1';

/** Platform statement on the terms page (applies to the whole service). */
export const PLATFORM_TERMS =
  '本服務只提供和弦譜產生與歌詞對齊的工具，不提供也不散布任何音訊。使用者上傳的內容由上傳者自行負責；本服務只在產生草稿所需的範圍內處理上傳的音訊，不公開，並依保留期限刪除。若您認為某些內容侵害您的權利，請聯絡管理員，我們會移除相關內容。';
