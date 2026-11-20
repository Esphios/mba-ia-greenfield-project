import {
  hashVideoRequest,
  normalizeVideoRequest,
} from './video-request-normalizer';

describe('video request normalization', () => {
  it('normalizes NFC/title and sanitizes the filename basename', () => {
    const normalized = normalizeVideoRequest({
      title: '  Cafe\u0301  ',
      filename: '..\\folder\\vi\u0000deo.mp4',
      sizeBytes: 123,
      contentType: 'video/mp4',
    });
    expect(normalized).toEqual({
      title: 'Café',
      filename: 'video.mp4',
      sizeBytes: 123,
      contentType: 'video/mp4',
    });
  });

  it('hashes the canonical ordered array deterministically', () => {
    const first = normalizeVideoRequest({
      title: 'Café',
      filename: 'video.mp4',
      sizeBytes: 123,
      contentType: 'video/mp4',
    });
    const second = normalizeVideoRequest({
      title: ' Cafe\u0301 ',
      filename: 'path/video.mp4',
      sizeBytes: 123,
      contentType: 'video/mp4',
    });
    expect(hashVideoRequest(first)).toBe(hashVideoRequest(second));
    expect(hashVideoRequest(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts long raw strings when their canonical values fit the limits', () => {
    const normalized = normalizeVideoRequest({
      title: `${' '.repeat(300)}Video${' '.repeat(300)}`,
      filename: `folder/${' '.repeat(300)}video.mp4${' '.repeat(300)}`,
      sizeBytes: 1,
      contentType: 'video/mp4',
    });
    expect(normalized).toMatchObject({
      title: 'Video',
      filename: 'video.mp4',
    });
  });

  it.each([
    {
      title: '',
      filename: 'video.mp4',
      sizeBytes: 1,
      contentType: 'video/mp4',
    },
    { title: 'ok', filename: '..', sizeBytes: 1, contentType: 'video/mp4' },
    {
      title: 'ok',
      filename: 'video.mp4',
      sizeBytes: 0,
      contentType: 'video/mp4',
    },
    {
      title: 'ok',
      filename: 'video.mp4',
      sizeBytes: 1,
      contentType: 'video/webm',
    },
  ])('rejects invalid canonical input %#', (input) => {
    expect(() => normalizeVideoRequest(input)).toThrow();
  });
});
