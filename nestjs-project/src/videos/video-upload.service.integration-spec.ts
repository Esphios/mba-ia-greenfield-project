import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794000000000 } from '../database/migrations/1794000000000-CreateVideos';
import { StorageService } from '../storage/storage.service';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VideoUploadSession } from './entities/video-upload-session.entity';
import { Video } from './entities/video.entity';
import { VideoUploadError, VideoUploadService } from './video-upload.service';
import { VideosRepository } from './videos.repository';
import { VideoUploadRepository } from './video-upload.repository';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../config/video.config';
import { MultipartProvisionerService } from './multipart-provisioner.service';
import {
  hashVideoRequest,
  normalizeVideoRequest,
} from './video-request-normalizer';

describe('VideoUploadService draft creation (integration)', () => {
  let dataSource: DataSource;
  let userId: string;
  let channelId: string;
  let uploadRepository: VideoUploadRepository;
  let storage: jest.Mocked<
    Pick<
      StorageService,
      | 'createMultipartUpload'
      | 'signUploadPart'
      | 'listParts'
      | 'completeMultipartUpload'
      | 'headObject'
      | 'deleteObject'
      | 'abortMultipartUpload'
      | 'listMultipartUploads'
    >
  >;
  let service: VideoUploadService;
  const request = {
    title: ' Video ',
    filename: 'folder/video.mp4',
    sizeBytes: 67_108_865,
    contentType: 'video/mp4',
  };

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, Video, VideoUploadSession, VideoProcessingOutbox],
      {
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1794000000000,
        ],
      },
    );
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => dataSource.destroy());

  beforeEach(async () => {
    for (const table of [
      'video_processing_outbox',
      'video_upload_sessions',
      'videos',
      'refresh_tokens',
      'verification_tokens',
      'channels',
      'users',
    ]) {
      await dataSource.query(`DELETE FROM ${table}`);
    }
    userId = randomUUID();
    channelId = randomUUID();
    await dataSource.query(
      `INSERT INTO users(id,email,password) VALUES($1,$2,'hash')`,
      [userId, `${userId}@test.local`],
    );
    await dataSource.query(
      `INSERT INTO channels(id,name,nickname,user_id) VALUES($1,'Test',$2,$3)`,
      [channelId, `channel-${channelId}`, userId],
    );
    storage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
      signUploadPart: jest.fn().mockResolvedValue('http://signed.test/part'),
      listParts: jest.fn().mockResolvedValue([]),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest
        .fn()
        .mockResolvedValue({ ContentLength: request.sizeBytes }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      listMultipartUploads: jest.fn().mockResolvedValue([]),
    };
    uploadRepository = new VideoUploadRepository(dataSource);
    service = new VideoUploadService(
      storage as unknown as StorageService,
      new ChannelsService(dataSource),
      new VideosRepository(dataSource),
      uploadRepository,
      new MultipartProvisionerService(
        uploadRepository,
        storage as unknown as StorageService,
      ),
      {
        publicUrl: 'http://localhost:3000',
        urlTtlSeconds: 900,
        workerConcurrency: 1,
        workDirectory: '/work/videos',
      } as ConfigType<typeof videoConfig>,
    );
  });

  it('creates one draft and replays the same canonical request', async () => {
    const key = randomUUID();
    const created = await service.createDraft(userId, key, request);
    const replay = await service.createDraft(userId, key.toUpperCase(), {
      ...request,
      title: 'Video',
      filename: 'video.mp4',
    });

    expect(created).toMatchObject({
      created: true,
      state: 'uploading',
      expected_parts: 2,
    });
    expect(replay).toMatchObject({
      created: false,
      provisioning: false,
      video_id: created.video_id,
      state: 'uploading',
    });
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM videos',
    );
    expect(Number(count)).toBe(1);
  });

  it.each([
    ['far ahead', new Date('2099-01-01T00:00:00Z')],
    ['far behind', new Date('2000-01-01T00:00:00Z')],
  ])('uses the database clock when the host is %s', async (_label, hostNow) => {
    const normalized = normalizeVideoRequest(request);
    const requestHash = hashVideoRequest(normalized);
    const key = randomUUID();
    const initial = await uploadRepository.reserveDraft(
      channelId,
      key,
      normalized,
      requestHash,
      randomUUID(),
      () => randomUUID().replaceAll('-', '').slice(0, 22),
    );
    await dataSource.query(
      `UPDATE video_upload_sessions
       SET operation_token=NULL,operation_until=NULL WHERE id=$1`,
      [initial.session_id],
    );
    const replayToken = randomUUID();
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout'],
    });
    jest.setSystemTime(hostNow);
    try {
      const replay = await uploadRepository.reserveDraft(
        channelId,
        key,
        normalized,
        requestHash,
        replayToken,
        () => 'unused-public-id-value',
      );
      expect(replay.provisioning).toBe(true);
      const [persisted] = await dataSource.query<
        {
          operation_token: string;
        }[]
      >('SELECT operation_token FROM video_upload_sessions WHERE id=$1', [
        initial.session_id,
      ]);
      expect(persisted.operation_token).toBe(replayToken);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports provisioning only when the database claim is acquired', async () => {
    const normalized = normalizeVideoRequest(request);
    const requestHash = hashVideoRequest(normalized);
    const key = randomUUID();
    const initial = await uploadRepository.reserveDraft(
      channelId,
      key,
      normalized,
      requestHash,
      randomUUID(),
      () => randomUUID().replaceAll('-', '').slice(0, 22),
    );

    const replay = await uploadRepository.reserveDraft(
      channelId,
      key,
      normalized,
      requestHash,
      randomUUID(),
      () => 'unused-public-id-value',
    );

    expect(initial.provisioning).toBe(true);
    expect(replay.provisioning).toBe(false);
  });

  it('rejects an idempotency conflict', async () => {
    const key = randomUUID();
    await service.createDraft(userId, key, request);
    await expect(
      service.createDraft(userId, key, { ...request, title: 'Different' }),
    ).rejects.toMatchObject<Partial<VideoUploadError>>({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('requires the authenticated user to own a channel', async () => {
    await expect(
      service.createDraft(randomUUID(), randomUUID(), request),
    ).rejects.toMatchObject({ code: 'CHANNEL_REQUIRED' });
  });

  it('reserves at most two concurrent uploads per channel', async () => {
    const results = await Promise.allSettled(
      [randomUUID(), randomUUID(), randomUUID()].map((key) =>
        service.createDraft(userId, key, request),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({
      reason: { code: 'UPLOAD_QUOTA_EXCEEDED' },
    });
  });

  it('persists the draft before storage and retries provisioning without duplication', async () => {
    let rejectStorage!: (error: Error) => void;
    storage.createMultipartUpload.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectStorage = reject;
        }),
    );
    const key = randomUUID();
    const pending = service.createDraft(userId, key, request);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const [{ count: duringStorage }] = await dataSource.query<
      { count: string }[]
    >('SELECT count(*)::text count FROM videos');
    expect(Number(duringStorage)).toBe(1);
    rejectStorage(new Error('offline'));
    await expect(pending).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    const [releasedClaim] = await dataSource.query<
      {
        operation_token: string | null;
        operation_until: Date | null;
      }[]
    >(
      `SELECT operation_token,operation_until FROM video_upload_sessions
       WHERE idempotency_key=$1`,
      [key],
    );
    expect(releasedClaim).toMatchObject({
      operation_token: null,
      operation_until: null,
    });

    const replay = await service.createDraft(userId, key, request);
    expect(replay).toMatchObject({ created: false, state: 'uploading' });
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM videos',
    );
    expect(Number(count)).toBe(1);
  });

  it('retries real public id uniqueness collisions up to a successful id', async () => {
    const collision = 'a'.repeat(22);
    await dataSource.query(
      `INSERT INTO videos
       (public_id,channel_id,title,original_filename,size_bytes,source_key)
       VALUES ($1,(SELECT id FROM channels WHERE user_id=$2),'Existing','x.mp4',1,$3)`,
      [collision, userId, `videos/${randomUUID()}/source.mp4`],
    );
    const unique = 'b'.repeat(22);
    const generator = jest
      .fn<string, []>()
      .mockReturnValueOnce(collision)
      .mockReturnValueOnce(collision)
      .mockReturnValueOnce(unique);
    const normalized = normalizeVideoRequest(request);
    const result = await uploadRepository.reserveDraft(
      channelId,
      randomUUID(),
      normalized,
      hashVideoRequest(normalized),
      randomUUID(),
      generator,
    );
    expect(result.public_id).toBe(unique);
    expect(generator).toHaveBeenCalledTimes(3);
  });

  it('enforces the global quota of ten across at least six channels', async () => {
    const userIds = [userId];
    for (let index = 0; index < 5; index += 1) {
      const otherUserId = randomUUID();
      const otherChannelId = randomUUID();
      userIds.push(otherUserId);
      await dataSource.query(
        `INSERT INTO users(id,email,password) VALUES($1,$2,'hash')`,
        [otherUserId, `${otherUserId}@test.local`],
      );
      await dataSource.query(
        `INSERT INTO channels(id,name,nickname,user_id) VALUES($1,'Test',$2,$3)`,
        [otherChannelId, `channel-${otherChannelId}`, otherUserId],
      );
    }

    for (let index = 0; index < 10; index += 1) {
      await service.createDraft(
        userIds[index % userIds.length],
        randomUUID(),
        request,
      );
    }
    await expect(
      service.createDraft(userIds[5], randomUUID(), request),
    ).rejects.toMatchObject({ code: 'UPLOAD_QUOTA_EXCEEDED' });
  });

  it('signs exact part sizes and lists confirmed parts for resumption', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    storage.listParts.mockResolvedValueOnce([
      { PartNumber: 1, Size: 67_108_864, ETag: 'etag-1' },
    ]);
    const signed = await service.signParts(userId, created.public_id, [1, 2]);
    expect(signed.map((part) => part.expectedSizeBytes)).toEqual([
      67_108_864, 1,
    ]);
    expect(storage.signUploadPart).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      'upload-id',
      2,
      1,
      expect.any(Number),
    );
    await expect(
      service.listUploadedParts(userId, created.public_id),
    ).resolves.toMatchObject([{ PartNumber: 1 }]);
  });

  it('returns incomplete to uploading without creating an outbox event', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    storage.listParts.mockResolvedValueOnce([
      { PartNumber: 1, Size: 67_108_864, ETag: 'etag-1' },
    ]);
    await expect(
      service.completeUpload(userId, created.public_id),
    ).rejects.toMatchObject({ code: 'UPLOAD_INCOMPLETE' });
    const [session] = await dataSource.query<{ state: string }[]>(
      'SELECT state FROM video_upload_sessions WHERE video_id=$1',
      [created.video_id],
    );
    expect(session.state).toBe('uploading');
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_processing_outbox',
    );
    expect(Number(count)).toBe(0);
  });

  it('returns size mismatch when every part exists with a wrong size', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    storage.listParts.mockResolvedValueOnce([
      { PartNumber: 1, Size: 67_108_864, ETag: 'etag-1' },
      { PartNumber: 2, Size: 2, ETag: 'etag-2' },
    ]);
    await expect(
      service.completeUpload(userId, created.public_id),
    ).rejects.toMatchObject({ code: 'UPLOAD_SIZE_MISMATCH' });
    expect(storage.abortMultipartUpload).toHaveBeenCalled();
  });

  it('completes once and persists processing with one outbox event', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    storage.listParts.mockResolvedValue([
      { PartNumber: 1, Size: 67_108_864, ETag: 'etag-1' },
      { PartNumber: 2, Size: 1, ETag: 'etag-2' },
    ]);
    await expect(
      service.completeUpload(userId, created.public_id),
    ).resolves.toBe('processing');
    await expect(
      service.completeUpload(userId, created.public_id),
    ).resolves.toBe('processing');
    for (const status of ['ready', 'error']) {
      await dataSource.query(
        `UPDATE videos SET status=$2::varchar,
           stream_key=CASE WHEN $2::varchar='ready' THEN 'stream.mp4' ELSE stream_key END,
           thumbnail_key=CASE WHEN $2::varchar='ready' THEN 'thumb.jpg' ELSE thumbnail_key END,
           duration_ms=CASE WHEN $2::varchar='ready' THEN 1000 ELSE duration_ms END,
           metadata=CASE WHEN $2::varchar='ready' THEN '{}'::jsonb ELSE metadata END,
           failure_code=CASE WHEN $2::varchar='error' THEN 'PROCESSING_FAILED' ELSE failure_code END
         WHERE id=$1`,
        [created.video_id, status],
      );
      await expect(
        service.completeUpload(userId, created.public_id),
      ).resolves.toBe(status);
    }
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_processing_outbox',
    );
    expect(Number(count)).toBe(1);
  });

  it('does not report processing when the finalization CAS is rejected', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    storage.listParts.mockResolvedValue([
      { PartNumber: 1, Size: 67_108_864, ETag: 'etag-1' },
      { PartNumber: 2, Size: 1, ETag: 'etag-2' },
    ]);
    jest
      .spyOn(uploadRepository, 'finalizeCompletion')
      .mockResolvedValueOnce({ outcome: 'conflict' });

    await expect(
      service.completeUpload(userId, created.public_id),
    ).rejects.toMatchObject({ code: 'UPLOAD_STATE_CONFLICT' });
  });

  it('recovers when completion commits but its database response is lost', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    storage.listParts.mockResolvedValue([
      { PartNumber: 1, Size: 67_108_864, ETag: 'etag-1' },
      { PartNumber: 2, Size: 1, ETag: 'etag-2' },
    ]);
    const finalize = uploadRepository.finalizeCompletion.bind(uploadRepository);
    jest
      .spyOn(uploadRepository, 'finalizeCompletion')
      .mockImplementationOnce(async (...args) => {
        await finalize(...args);
        throw new Error('database response lost');
      });

    await expect(
      service.completeUpload(userId, created.public_id),
    ).rejects.toThrow('database response lost');
    await expect(
      service.completeUpload(userId, created.public_id),
    ).resolves.toBe('processing');
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('persists abort before the remote cleanup and replays idempotently', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    await service.abortUpload(userId, created.public_id);
    await service.abortUpload(userId, created.public_id);
    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    const [session] = await dataSource.query<
      { state: string; cleanup_state: string }[]
    >(
      `SELECT s.state,o.state cleanup_state FROM video_upload_sessions s
       JOIN video_cleanup_obligations o ON o.session_id=s.id WHERE s.video_id=$1`,
      [created.video_id],
    );
    expect(session.state).toBe('aborted');
    expect(session.cleanup_state).toBe('pending');
  });

  it('does not resurrect an upload aborted while multipart creation is in flight', async () => {
    let releaseCreate!: (uploadId: string) => void;
    storage.createMultipartUpload.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseCreate = resolve;
        }),
    );

    const creating = service.createDraft(userId, randomUUID(), request);
    let draft: { public_id: string } | undefined;
    for (let attempt = 0; attempt < 20 && !draft; attempt += 1) {
      [draft] = await dataSource.query<{ public_id: string }[]>(
        `SELECT v.public_id FROM videos v
         JOIN video_upload_sessions s ON s.video_id=v.id
         WHERE s.state='initiating' ORDER BY s.created_at DESC LIMIT 1`,
      );
      if (!draft) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(draft).toBeDefined();

    await service.abortUpload(userId, draft!.public_id);
    releaseCreate('late-upload-id');

    await expect(creating).rejects.toThrow('UPLOAD_STATE_CONFLICT');
    expect(storage.abortMultipartUpload).not.toHaveBeenCalledWith(
      expect.stringMatching(/\/source\.mp4$/),
      'late-upload-id',
    );
    const [session] = await dataSource.query<{ state: string }[]>(
      `SELECT state FROM video_upload_sessions s
       JOIN videos v ON v.id=s.video_id WHERE v.public_id=$1`,
      [draft!.public_id],
    );
    expect(session.state).toBe('aborted');
  });

  it('protects completion accepted before TTL from expiry and concurrent abort', async () => {
    const created = await service.createDraft(userId, randomUUID(), request);
    let releaseParts!: (
      value: { PartNumber: number; Size: number; ETag: string }[],
    ) => void;
    storage.listParts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseParts = resolve;
        }),
    );
    const completion = service.completeUpload(userId, created.public_id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=now()-interval '1 second'
       WHERE video_id=$1`,
      [created.video_id],
    );
    await expect(
      service.abortUpload(userId, created.public_id),
    ).rejects.toMatchObject({
      code: 'UPLOAD_STATE_CONFLICT',
    });
    releaseParts([
      { PartNumber: 1, Size: 67_108_864, ETag: 'etag-1' },
      { PartNumber: 2, Size: 1, ETag: 'etag-2' },
    ]);
    await expect(completion).resolves.toBe('processing');
    await expect(
      service.completeUpload(userId, created.public_id),
    ).resolves.toBe('processing');
  });

  it('observes delayed expiry uniformly without starting storage I/O', async () => {
    const key = randomUUID();
    const created = await service.createDraft(userId, key, request);
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=now()-interval '1 second'
       WHERE id=$1`,
      [created.session_id],
    );
    jest.clearAllMocks();

    const replay = await service.createDraft(userId, key, request);
    expect(replay).toMatchObject({ state: 'expired', provisioning: false });
    await expect(
      service.listUploadedParts(userId, created.public_id),
    ).resolves.toEqual([]);
    await expect(
      service.getUploadState(userId, created.public_id),
    ).resolves.toMatchObject({ state: 'expired', uploadedParts: [] });
    await expect(
      service.signParts(userId, created.public_id, [1]),
    ).rejects.toMatchObject({ code: 'UPLOAD_EXPIRED' });
    await expect(
      service.completeUpload(userId, created.public_id),
    ).rejects.toMatchObject({ code: 'UPLOAD_EXPIRED' });

    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(storage.headObject).not.toHaveBeenCalled();
    const [obligation] = await dataSource.query<{ state: string }[]>(
      `SELECT state FROM video_cleanup_obligations WHERE session_id=$1`,
      [created.session_id],
    );
    expect(obligation.state).toBe('pending');
  });
});
