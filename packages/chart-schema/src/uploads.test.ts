import { describe, expect, it } from 'vitest';
import { AudioUploadMetadataSchema, AudioUploadSchema, type AudioUpload } from './uploads';

const metadata = {
  title: '晨光小路',
  artist: null,
  declarationVersion: 'audio-upload-v1',
  declarationAccepted: true,
};

const upload: AudioUpload = {
  id: 'upl_0123456789abcdef',
  sourceReferenceId: 'src_0123456789abcdef',
  title: '晨光小路',
  artist: '自彈自唱',
  format: 'wav',
  sizeBytes: 44_144,
  sha256: 'a'.repeat(64),
  status: 'active',
  declarationVersion: 'audio-upload-v1',
  owner: { id: 'usr_owner', name: '擁有者' },
  uploadedAt: '2026-11-02T08:00:00.000Z',
  expiresAt: '2026-12-02T08:00:00.000Z',
  endedAt: null,
};

describe('audio upload contract', () => {
  it('accepts upload metadata with an accepted declaration', () => {
    expect(AudioUploadMetadataSchema.parse({ ...metadata, title: '  晨光小路 ' }).title).toBe(
      '晨光小路',
    );
  });

  it.each([
    ['an empty title', { title: '   ' }],
    ['a declaration that was not accepted', { declarationAccepted: false }],
    ['a malformed declaration version', { declarationVersion: 'v1' }],
    ['an empty artist (send null instead)', { artist: '' }],
    ['an unknown field', { url: 'https://example.org/song.mp3' }],
  ])('rejects %s', (_label, patch) => {
    expect(AudioUploadMetadataSchema.safeParse({ ...metadata, ...patch }).success).toBe(false);
  });

  it('describes an upload without any public location', () => {
    expect(AudioUploadSchema.parse(upload)).toEqual(upload);
    expect(AudioUploadSchema.safeParse({ ...upload, storagePath: 'uploads/x' }).success).toBe(
      false,
    );
    expect(AudioUploadSchema.safeParse({ ...upload, format: 'aac' }).success).toBe(false);
    expect(AudioUploadSchema.safeParse({ ...upload, sha256: 'A'.repeat(64) }).success).toBe(false);
  });
});
