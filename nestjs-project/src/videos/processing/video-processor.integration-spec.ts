import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const workerDescribe =
  process.env.VIDEO_WORKER_INTEGRATION === '1' ? describe : describe.skip;

workerDescribe('VideoProcessorService (FFmpeg, PostgreSQL, MinIO)', () => {
  const valid = '/tmp/phase03-smoke.mp4';
  const unsupported = '/tmp/phase03-unsupported.mp4';
  const subtitle = '/tmp/phase03-subtitle.mp4';
  const corrupted = '/tmp/phase03-corrupt.mp4';
  const audioCorrupted = '/tmp/phase03-audio-corrupt.mp4';
  const extraAudio = '/tmp/phase03-extra-audio.mp4';
  const extraVideo = '/tmp/phase03-extra-video.mp4';
  const audioOnly = '/tmp/phase03-audio-only.mp4';
  const externalReference = '/tmp/phase03-external-reference.mp4';

  beforeAll(() => {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      valid,
    ]);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-t',
      '2',
      '-c:v',
      'mpeg4',
      '-y',
      unsupported,
    ]);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '2',
      '-c:a',
      'aac',
      '-y',
      audioOnly,
    ]);
    const srt = '/tmp/phase03-subtitle.srt';
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
    writeFileSync(
      externalReference,
      '#EXTM3U\n#EXTINF:10,\nhttp://127.0.0.1:9/segment.ts\n',
    );
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      valid,
      '-i',
      srt,
      '-map',
      '0',
      '-map',
      '1',
      '-c',
      'copy',
      '-c:s',
      'mov_text',
      '-y',
      subtitle,
    ]);
    for (const [target, maps] of [
      [extraAudio, ['0:v:0', '0:a:0', '0:a:0']],
      [extraVideo, ['0:v:0', '0:v:0', '0:a:0']],
    ] as const) {
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        valid,
        ...maps.flatMap((map) => ['-map', map]),
        '-c',
        'copy',
        '-y',
        target,
      ]);
    }
    const audioPackets = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_packets',
        '-show_entries',
        'packet=pos,size,pts_time',
        '-of',
        'json',
        valid,
      ]).toString(),
    ) as { packets?: { pos?: string; size?: string; pts_time?: string }[] };
    const damagedAudio = readFileSync(valid);
    let damagedPackets = 0;
    for (const packet of audioPackets.packets ?? []) {
      const position = Number(packet.pos);
      const size = Number(packet.size);
      if (
        Number(packet.pts_time) < 0.5 ||
        !Number.isSafeInteger(position) ||
        !Number.isSafeInteger(size) ||
        size < 1
      )
        continue;
      damagedAudio.fill(0xff, position, position + size);
      damagedPackets++;
    }
    if (damagedPackets < 10) throw new Error('Too few AAC packets to corrupt');
    writeFileSync(audioCorrupted, damagedAudio);
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '15',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-shortest',
      '-y',
      corrupted,
    ]);
    const bytes = readFileSync(corrupted);
    const offset = Math.floor(bytes.length * 0.7);
    bytes.fill(0, offset, offset + 16_384);
    writeFileSync(corrupted, bytes);
  });

  function runSmoke(env: Record<string, string>): string {
    return execFileSync(
      process.execPath,
      ['test/support/video-worker-smoke.cjs'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VIDEO_WORK_DIR: '/tmp/phase03-worker-integration',
          SMOKE_CLEANUP: '1',
          ...env,
        },
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      },
    ).toString();
  }

  it('publishes faststart MP4 and JPEG with typed metadata', () => {
    expect(runSmoke({ SMOKE_LOST_COMMIT: '1' })).toContain('"status":"ready"');
  });

  it('rejects an unsupported codec', () => {
    expect(
      runSmoke({
        SMOKE_SOURCE_PATH: unsupported,
        SMOKE_LOST_COMMIT: '1',
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'UNSUPPORTED_VIDEO',
      }),
    ).toContain('UNSUPPORTED_VIDEO');
  });

  it('classifies a real audio-only MP4 as invalid video', () => {
    expect(
      runSmoke({
        SMOKE_SOURCE_PATH: audioOnly,
        SMOKE_LOST_COMMIT: '1',
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'INVALID_VIDEO',
      }),
    ).toContain('INVALID_VIDEO');
  });

  it('rejects an external media reference under the local-only demuxer policy', () => {
    expect(
      runSmoke({
        SMOKE_SOURCE_PATH: externalReference,
        SMOKE_LOST_COMMIT: '1',
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'INVALID_VIDEO',
      }),
    ).toContain('INVALID_VIDEO');
  });

  it('rejects an extra subtitle track', () => {
    expect(
      runSmoke({
        SMOKE_SOURCE_PATH: subtitle,
        SMOKE_LOST_COMMIT: '1',
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'UNSUPPORTED_VIDEO',
      }),
    ).toContain('UNSUPPORTED_VIDEO');
  });

  it.each([
    ['second AAC track', extraAudio],
    ['second H.264 track', extraVideo],
  ])('rejects a %s', (_name, source) => {
    expect(
      runSmoke({
        SMOKE_SOURCE_PATH: source,
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'UNSUPPORTED_VIDEO',
      }),
    ).toContain('UNSUPPORTED_VIDEO');
  });

  it('detects corruption in selected AAC after a valid opening', () => {
    expect(
      runSmoke({
        SMOKE_SOURCE_PATH: audioCorrupted,
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'INVALID_VIDEO',
      }),
    ).toContain('INVALID_VIDEO');
  });

  it('detects corruption after the thumbnail frame', () => {
    expect(
      runSmoke({
        SMOKE_SOURCE_PATH: corrupted,
        SMOKE_LOST_COMMIT: '1',
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'INVALID_VIDEO',
      }),
    ).toContain('INVALID_VIDEO');
  });

  it('does not delete a winner after a lost commit response', () => {
    expect(runSmoke({ SMOKE_LOST_COMMIT: '1' })).toContain('"status":"ready"');
  });

  it('rejects a stale lease and deletes its derivatives', () => {
    expect(
      runSmoke({ SMOKE_STALE_CAS: '1', SMOKE_EXPECT_STATUS: 'processing' }),
    ).toContain('"staleCleanup":true');
  });

  it('keeps derivatives when the database cannot resolve the commit', () => {
    expect(
      runSmoke({
        SMOKE_DB_UNAVAILABLE: '1',
        SMOKE_EXPECT_STATUS: 'processing',
      }),
    ).toContain('"cleanupDeferred":true');
  });

  it('persists three transient failures as terminal error', () => {
    expect(
      runSmoke({
        SMOKE_SKIP_UPLOAD: '1',
        SMOKE_DIRECT_ATTEMPTS: '3',
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'PROCESSING_FAILED',
      }),
    ).toContain('PROCESSING_FAILED');
  });

  it('enforces the total pipeline deadline across retries', () => {
    expect(
      runSmoke({
        VIDEO_TEST_TOTAL_DEADLINE_MS: '1',
        SMOKE_DIRECT_ATTEMPTS: '3',
        SMOKE_EXPECT_STATUS: 'error',
        SMOKE_EXPECT_FAILURE_CODE: 'PROCESSING_TIMEOUT',
      }),
    ).toContain('PROCESSING_TIMEOUT');
  });
});
