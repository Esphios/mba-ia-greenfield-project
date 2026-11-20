import { VideoProcessorService } from './video-processor.service';
import { Readable } from 'node:stream';

describe('VideoProcessorService process limits', () => {
  const service = new VideoProcessorService(
    {} as never,
    {} as never,
    {} as never,
  );
  const validProbe = {
    streams: [
      {
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        pix_fmt: 'yuv420p',
        width: 320,
        height: 240,
        avg_frame_rate: '25/1',
      },
    ],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2.001' },
  };

  it('keeps explicit track indexes and millisecond precision with AAC', () => {
    const result = service['validateProbe']({
      ...validProbe,
      streams: [
        {
          index: 2,
          codec_type: 'video',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
          width: 320,
          height: 240,
          avg_frame_rate: '30000/1001',
        },
        { index: 0, codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(result).toMatchObject({
      videoIndex: 2,
      audioIndex: 0,
      durationMs: 2001,
      metadata: {
        audioCodec: 'aac',
        fps: { numerator: 30000, denominator: 1001 },
      },
    });
    expect(service['validateProbe'](validProbe).metadata.audioCodec).toBeNull();
  });

  it.each([
    [
      'no video stream',
      {
        ...validProbe,
        streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac' }],
      },
      'INVALID_VIDEO',
    ],
    [
      'zero fps',
      {
        ...validProbe,
        streams: [{ ...validProbe.streams[0], avg_frame_rate: '0/0' }],
      },
      'INVALID_VIDEO',
    ],
    [
      'nonfinite duration',
      { ...validProbe, format: { ...validProbe.format, duration: 'NaN' } },
      'INVALID_VIDEO',
    ],
    [
      'zero duration',
      { ...validProbe, format: { ...validProbe.format, duration: '0' } },
      'INVALID_VIDEO',
    ],
    [
      'second video',
      {
        ...validProbe,
        streams: [
          ...validProbe.streams,
          { ...validProbe.streams[0], index: 1 },
        ],
      },
      'UNSUPPORTED_VIDEO',
    ],
    [
      'second audio',
      {
        ...validProbe,
        streams: [
          ...validProbe.streams,
          { index: 1, codec_type: 'audio', codec_name: 'aac' },
          { index: 2, codec_type: 'audio', codec_name: 'aac' },
        ],
      },
      'UNSUPPORTED_VIDEO',
    ],
    [
      'cover art',
      {
        ...validProbe,
        streams: [
          { ...validProbe.streams[0], disposition: { attached_pic: 1 } },
        ],
      },
      'UNSUPPORTED_VIDEO',
    ],
    [
      'data track',
      {
        ...validProbe,
        streams: [...validProbe.streams, { index: 1, codec_type: 'data' }],
      },
      'UNSUPPORTED_VIDEO',
    ],
  ])('rejects %s metadata', (_name, probe, code) => {
    expect(() => service['validateProbe'](probe)).toThrow(code);
  });

  it('enforces the total deadline before starting a later subprocess', () => {
    expect(() => service['remaining'](Date.now() - 1, 60_000)).toThrow(
      'PROCESSING_TIMEOUT',
    );
  });

  it('stops a subprocess that exceeds its deadline', async () => {
    await expect(
      service.runCommand(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 10000)'],
        100,
        1024,
      ),
    ).rejects.toThrow('PROCESSING_TIMEOUT');
  });

  it('stops a subprocess that exceeds its output budget', async () => {
    await expect(
      service.runCommand(
        process.execPath,
        ['-e', 'process.stdout.write("x".repeat(5000))'],
        5000,
        1024,
      ),
    ).rejects.toThrow('INVALID_VIDEO');
  });

  it('classifies ENOSPC from a media command as transient infrastructure failure', async () => {
    await expect(
      service.runCommand(
        process.execPath,
        [
          '-e',
          'process.stderr.write("ENOSPC: no space left"); process.exit(1)',
        ],
        5000,
        1024,
        undefined,
        'INVALID_VIDEO',
      ),
    ).rejects.toMatchObject({
      message: 'PROCESSING_FAILED',
      permanent: false,
    });
  });

  it('cancels a blocked download at the total deadline without a late ready CAS', async () => {
    const previousDeadline = process.env.VIDEO_TEST_TOTAL_DEADLINE_MS;
    process.env.VIDEO_TEST_TOTAL_DEADLINE_MS = '30';
    const repository = {
      claimProcessing: jest.fn(async () => ({
        id: 'video-id',
        attempt_id: 'attempt-id',
        size_bytes: '1',
        source_key: 'source-key',
      })),
      heartbeat: jest.fn(async () => true),
      findProcessingState: jest.fn(async () => ({ status: 'processing' })),
      recordProcessingFailure: jest.fn(async () => 'processing'),
      markReady: jest.fn(),
    };
    let observedSignal: AbortSignal | undefined;
    const storage = {
      downloadStream: jest.fn(
        (_key: string, _maximum: number, signal?: AbortSignal) => {
          observedSignal = signal;
          return new Promise<Readable>((_resolve, reject) =>
            signal?.addEventListener(
              'abort',
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('aborted'),
                ),
              { once: true },
            ),
          );
        },
      ),
      deleteObject: jest.fn(async () => undefined),
    };
    const processor = new VideoProcessorService(
      repository as never,
      storage as never,
      { workDirectory: '/tmp/streamtube-deadline-test' } as never,
    );

    try {
      await expect(processor.process('video-id')).rejects.toThrow(
        'PROCESSING_TIMEOUT',
      );
      expect(observedSignal?.aborted).toBe(true);
      expect(repository.markReady).not.toHaveBeenCalled();
    } finally {
      if (previousDeadline === undefined)
        delete process.env.VIDEO_TEST_TOTAL_DEADLINE_MS;
      else process.env.VIDEO_TEST_TOTAL_DEADLINE_MS = previousDeadline;
    }
  });

  it('terminates the active media command when the processing lease is lost', async () => {
    const previousHeartbeat = process.env.VIDEO_TEST_HEARTBEAT_MS;
    process.env.VIDEO_TEST_HEARTBEAT_MS = '10';
    let commandStarted = false;
    const repository = {
      claimProcessing: jest.fn(async () => ({
        id: 'video-id',
        attempt_id: 'attempt-id',
        size_bytes: '1',
        source_key: 'source-key',
      })),
      heartbeat: jest.fn(async () => !commandStarted),
      findProcessingState: jest.fn(async () => ({ status: 'processing' })),
      recordProcessingFailure: jest.fn(async () => 'processing'),
      markReady: jest.fn(),
    };
    const storage = {
      downloadStream: jest.fn(async () => Readable.from(Buffer.from([1]))),
      deleteObject: jest.fn(async () => undefined),
    };
    const processor = new VideoProcessorService(
      repository as never,
      storage as never,
      { workDirectory: '/tmp/streamtube-lease-test' } as never,
    );
    let commandClosed = false;
    jest
      .spyOn(processor, 'runCommand')
      .mockResolvedValueOnce(JSON.stringify(validProbe))
      .mockImplementationOnce(
        (_command, _args, _timeout, _limit, signal?: AbortSignal) => {
          commandStarted = true;
          return new Promise<string>((_resolve, reject) =>
            signal?.addEventListener(
              'abort',
              () => {
                commandClosed = true;
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error('aborted'),
                );
              },
              { once: true },
            ),
          );
        },
      );

    try {
      await expect(processor.process('video-id')).rejects.toThrow(
        'PROCESSING_FAILED',
      );
      expect(commandClosed).toBe(true);
      expect(repository.markReady).not.toHaveBeenCalled();
    } finally {
      if (previousHeartbeat === undefined)
        delete process.env.VIDEO_TEST_HEARTBEAT_MS;
      else process.env.VIDEO_TEST_HEARTBEAT_MS = previousHeartbeat;
    }
  });

  it.each(['ready', 'error'])(
    'treats redelivery of %s as a no-op',
    async (status) => {
      const repository = {
        claimProcessing: jest.fn(async () => null),
        findProcessingState: jest.fn(async () => ({ status })),
      };
      const storage = { downloadStream: jest.fn(), deleteObject: jest.fn() };
      const processor = new VideoProcessorService(
        repository as never,
        storage as never,
        {} as never,
      );
      await expect(processor.process('video-id')).resolves.toBeUndefined();
      expect(repository.claimProcessing).toHaveBeenCalledTimes(1);
      expect(storage.downloadStream).not.toHaveBeenCalled();
      expect(storage.deleteObject).not.toHaveBeenCalled();
    },
  );
});
