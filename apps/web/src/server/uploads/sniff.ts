import type { AudioFormat } from '@chordflow/chart-schema';

/** Bytes needed to recognise every accepted container. */
export const SNIFF_BYTES = 12;

/** ISO base media brands used by M4A/AAC audio files. */
const M4A_BRANDS = new Set(['M4A ', 'M4B ', 'mp41', 'mp42', 'isom', 'iso2']);

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * Detects the audio container from the first bytes of the file. File names and
 * browser-supplied MIME types are never trusted; decoding happens in the worker.
 */
export function sniffAudioFormat(head: Uint8Array): AudioFormat | null {
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') {
    return 'wav';
  }
  if (head.length >= 4 && ascii(head, 0, 4) === 'fLaC') return 'flac';
  if (head.length >= 4 && ascii(head, 0, 4) === 'OggS') return 'ogg';
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp' && M4A_BRANDS.has(ascii(head, 8, 4))) {
    return 'm4a';
  }
  if (head.length >= 3 && ascii(head, 0, 3) === 'ID3') return 'mp3';
  // Bare MPEG audio frame: 11 sync bits, then a version and a layer that are not reserved.
  const [first, second] = [head[0], head[1]];
  if (
    first === 0xff &&
    second !== undefined &&
    (second & 0xe0) === 0xe0 &&
    (second & 0x18) !== 0x08 &&
    (second & 0x06) !== 0x00
  ) {
    return 'mp3';
  }
  return null;
}
