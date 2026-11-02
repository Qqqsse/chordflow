import { describe, expect, it } from 'vitest';
import { sniffAudioFormat } from './sniff';

const ascii = new TextEncoder();
const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((part) => (typeof part === 'string' ? [...ascii.encode(part)] : part)),
  );

describe('audio format detection from file headers', () => {
  it.each([
    ['wav', bytes('RIFF', [0x24, 0, 0, 0], 'WAVE')],
    ['flac', bytes('fLaC', [0, 0, 0, 0x22])],
    ['ogg', bytes('OggS', [0, 2])],
    ['mp3', bytes('ID3', [4, 0, 0])],
    ['mp3', bytes([0xff, 0xfb, 0x90, 0x64])],
    ['m4a', bytes([0, 0, 0, 0x20], 'ftyp', 'M4A ')],
    ['m4a', bytes([0, 0, 0, 0x18], 'ftyp', 'isom')],
  ])('recognises %s', (format, head) => {
    expect(sniffAudioFormat(head)).toBe(format);
  });

  it.each([
    ['a RIFF file that is not WAVE (AVI)', bytes('RIFF', [0, 0, 0, 0], 'AVI ')],
    ['an MP4 video brand', bytes([0, 0, 0, 0x20], 'ftyp', 'qt  ')],
    ['ADTS AAC (layer bits 00)', bytes([0xff, 0xf1, 0x50, 0x80])],
    ['a reserved MPEG version', bytes([0xff, 0xeb, 0x90, 0x64])],
    ['HTML', bytes('<!doctype html>')],
    ['a PNG image', bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])],
    ['an empty file', bytes()],
    ['a truncated WAV header', bytes('RIFF')],
  ])('rejects %s', (_label, head) => {
    expect(sniffAudioFormat(head)).toBeNull();
  });
});
