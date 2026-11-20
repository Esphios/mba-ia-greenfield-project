import { createHash } from 'node:crypto';
import { MAX_VIDEO_BYTES } from '../common/video-limits';

export interface NormalizedVideoRequest {
  title: string;
  filename: string;
  sizeBytes: number;
  contentType: 'video/mp4';
}

function codePointLength(value: string): number {
  return [...value].length;
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('');
}

export function normalizeVideoRequest(input: {
  title: unknown;
  filename: unknown;
  sizeBytes: unknown;
  contentType: unknown;
}): NormalizedVideoRequest {
  if (
    typeof input.title !== 'string' ||
    typeof input.filename !== 'string' ||
    typeof input.sizeBytes !== 'number' ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.contentType !== 'video/mp4'
  ) {
    throw new Error('Invalid video request');
  }

  const title = input.title.normalize('NFC').trim();
  const filenameSegment = input.filename
    .normalize('NFC')
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)!;
  const filename = stripControlCharacters(filenameSegment).trim();

  if (codePointLength(title) < 1 || codePointLength(title) > 200) {
    throw new Error('Invalid video title');
  }
  if (
    codePointLength(filename) < 1 ||
    codePointLength(filename) > 255 ||
    filename === '.' ||
    filename === '..'
  ) {
    throw new Error('Invalid video filename');
  }
  if (input.sizeBytes < 1 || input.sizeBytes > MAX_VIDEO_BYTES) {
    throw new Error('Invalid video size');
  }

  return {
    title,
    filename,
    sizeBytes: input.sizeBytes,
    contentType: 'video/mp4',
  };
}

export function hashVideoRequest(request: NormalizedVideoRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.title,
        request.filename,
        request.sizeBytes,
        request.contentType,
      ]),
      'utf8',
    )
    .digest('hex');
}
