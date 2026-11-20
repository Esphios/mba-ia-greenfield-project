import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794000000000 } from '../database/migrations/1794000000000-CreateVideos';
import { StorageService } from '../storage/storage.service';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VideoUploadSession } from './entities/video-upload-session.entity';
import { Video } from './entities/video.entity';
import { UploadReconcilerService } from './upload-reconciler.service';
import { UploadReconcilerRepository } from './upload-reconciler.repository';
import { VideoUploadRepository } from './video-upload.repository';
import { MultipartProvisionerService } from './multipart-provisioner.service';

describe('UploadReconcilerService (integration)', () => {
  let dataSource: DataSource;
  let storage: jest.Mocked<
    Pick<
      StorageService,
      | 'headObject'
      | 'listParts'
      | 'completeMultipartUpload'
      | 'abortMultipartUpload'
      | 'createMultipartUpload'
      | 'deleteObject'
      | 'listMultipartUploads'
    >
  >;
  let reconciler: UploadReconcilerService;
  let channelId: string;

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
    const userId = randomUUID();
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
      headObject: jest.fn(),
      listParts: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      createMultipartUpload: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      listMultipartUploads: jest.fn().mockResolvedValue([]),
    };
    storage.headObject.mockRejectedValue({
      $metadata: { httpStatusCode: 404 },
    });
    reconciler = new UploadReconcilerService(
      new UploadReconcilerRepository(dataSource),
      storage as unknown as StorageService,
      new MultipartProvisionerService(
        new VideoUploadRepository(dataSource),
        storage as unknown as StorageService,
      ),
    );
  });

  async function seedSession(
    state: 'initiating' | 'uploading' | 'completing',
    expired: boolean,
    storageUploadId: string | null = 'upload-id',
  ): Promise<{ videoId: string; sessionId: string }> {
    const videoId = randomUUID();
    const sessionId = randomUUID();
    await dataSource.query(
      `INSERT INTO videos
       (id,public_id,channel_id,title,original_filename,size_bytes,source_key)
       VALUES($1,$2,$3,'Video','video.mp4',67108865,$4)`,
      [
        videoId,
        randomUUID().replaceAll('-', '').slice(0, 22),
        channelId,
        `videos/${videoId}/source.mp4`,
      ],
    );
    await dataSource.query(
      `INSERT INTO video_upload_sessions
       (id,video_id,channel_id,idempotency_key,request_hash,storage_upload_id,
        state,expected_parts,expires_at,operation_until)
       VALUES($1,$2,$3,$4,$5,$6,$7,2,
              ${expired ? "now()-interval '1 second'" : "now()+interval '1 hour'"},
              now()-interval '1 second')`,
      [
        sessionId,
        videoId,
        channelId,
        randomUUID(),
        'a'.repeat(64),
        storageUploadId,
        state,
      ],
    );
    return { videoId, sessionId };
  }

  it('adopts one deterministic multipart upload after a post-create crash and aborts extras', async () => {
    const { sessionId, videoId } = await seedSession('initiating', false, null);
    const [{ source_key: sourceKey }] = await dataSource.query<
      { source_key: string }[]
    >('SELECT source_key FROM videos WHERE id=$1', [videoId]);
    storage.listMultipartUploads.mockResolvedValueOnce([
      { Key: `${sourceKey}.other`, UploadId: 'prefix-neighbor' },
      {
        Key: sourceKey,
        UploadId: 'later',
        Initiated: new Date('2026-01-02T00:00:00Z'),
      },
      {
        Key: sourceKey,
        UploadId: 'winner',
        Initiated: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    await expect(reconciler.reconcileInitiating()).resolves.toBe(1);

    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      sourceKey,
      'later',
    );
    const [session] = await dataSource.query<
      { state: string; storage_upload_id: string }[]
    >('SELECT state,storage_upload_id FROM video_upload_sessions WHERE id=$1', [
      sessionId,
    ]);
    expect(session).toMatchObject({
      state: 'uploading',
      storage_upload_id: 'winner',
    });
  });

  it('creates a multipart upload only when none exists and persists it after relisting', async () => {
    const { sessionId, videoId } = await seedSession('initiating', false, null);
    const [{ source_key: sourceKey }] = await dataSource.query<
      { source_key: string }[]
    >('SELECT source_key FROM videos WHERE id=$1', [videoId]);
    storage.listMultipartUploads
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ Key: sourceKey, UploadId: 'created' }]);
    storage.createMultipartUpload.mockResolvedValueOnce('created');

    await expect(reconciler.reconcileInitiating()).resolves.toBe(1);
    expect(storage.createMultipartUpload).toHaveBeenCalledWith(
      sourceKey,
      'video/mp4',
    );
    const [session] = await dataSource.query<
      { state: string; storage_upload_id: string }[]
    >('SELECT state,storage_upload_id FROM video_upload_sessions WHERE id=$1', [
      sessionId,
    ]);
    expect(session).toMatchObject({
      state: 'uploading',
      storage_upload_id: 'created',
    });
  });

  it('recovers a multipart create accepted remotely after its response is lost', async () => {
    const { sessionId, videoId } = await seedSession('initiating', false, null);
    const [{ source_key: sourceKey }] = await dataSource.query<
      { source_key: string }[]
    >('SELECT source_key FROM videos WHERE id=$1', [videoId]);
    storage.listMultipartUploads
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { Key: sourceKey, UploadId: 'accepted-with-lost-response' },
      ]);
    storage.createMultipartUpload.mockRejectedValueOnce(
      new Error('request timed out after remote acceptance'),
    );

    await expect(reconciler.reconcileInitiating()).resolves.toBe(0);
    await expect(reconciler.reconcileInitiating()).resolves.toBe(1);

    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    const [session] = await dataSource.query<
      { state: string; storage_upload_id: string }[]
    >('SELECT state,storage_upload_id FROM video_upload_sessions WHERE id=$1', [
      sessionId,
    ]);
    expect(session).toMatchObject({
      state: 'uploading',
      storage_upload_id: 'accepted-with-lost-response',
    });
  });

  it('fences a stale owner and aborts only its losing remote upload', async () => {
    const { sessionId, videoId } = await seedSession('initiating', false, null);
    const [{ source_key: sourceKey }] = await dataSource.query<
      { source_key: string }[]
    >('SELECT source_key FROM videos WHERE id=$1', [videoId]);
    storage.listMultipartUploads.mockImplementationOnce(async () => {
      await dataSource.query(
        `UPDATE video_upload_sessions
         SET state='uploading',storage_upload_id='winner',
             operation_token=NULL,operation_until=NULL
         WHERE id=$1`,
        [sessionId],
      );
      return [{ Key: sourceKey, UploadId: 'stale-owner-upload' }];
    });

    await expect(reconciler.reconcileInitiating()).resolves.toBe(1);

    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      sourceKey,
      'stale-owner-upload',
    );
    const [session] = await dataSource.query<
      { state: string; storage_upload_id: string }[]
    >('SELECT state,storage_upload_id FROM video_upload_sessions WHERE id=$1', [
      sessionId,
    ]);
    expect(session).toMatchObject({
      state: 'uploading',
      storage_upload_id: 'winner',
    });
  });

  it('never aborts the winner persisted by a replay after its lease is lost', async () => {
    const { sessionId, videoId } = await seedSession('initiating', false, null);
    const [{ source_key: sourceKey }] = await dataSource.query<
      { source_key: string }[]
    >('SELECT source_key FROM videos WHERE id=$1', [videoId]);
    storage.listMultipartUploads.mockImplementationOnce(async () => {
      await dataSource.query(
        `UPDATE video_upload_sessions
         SET state='uploading',storage_upload_id='replay-winner',
             operation_token=NULL,operation_until=NULL
         WHERE id=$1`,
        [sessionId],
      );
      return [
        {
          Key: sourceKey,
          UploadId: 'stale-owner-upload',
          Initiated: new Date('2026-01-01T00:00:00Z'),
        },
        {
          Key: sourceKey,
          UploadId: 'replay-winner',
          Initiated: new Date('2026-01-02T00:00:00Z'),
        },
      ];
    });

    await expect(reconciler.reconcileInitiating()).resolves.toBe(1);

    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      sourceKey,
      'stale-owner-upload',
    );
    expect(storage.abortMultipartUpload).not.toHaveBeenCalledWith(
      sourceKey,
      'replay-winner',
    );
  });

  it('never interprets HEAD 5xx as absence or deletes data', async () => {
    const { sessionId } = await seedSession('completing', false);
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    storage.headObject.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'token=bearer-secret https://storage/object?X-Amz-Credential=credential-secret',
        ),
        {
          code: 'STORAGE_UNAVAILABLE',
          stderr: 'private stderr',
          $metadata: { httpStatusCode: 503 },
        },
      ),
    );
    await expect(reconciler.reconcileCompleting()).resolves.toBe(0);
    const serializedLog = JSON.stringify(log.mock.calls);
    expect(serializedLog).toContain(
      'video_upload_completion_recovery_deferred',
    );
    expect(serializedLog).toContain('STORAGE_UNAVAILABLE');
    expect(serializedLog).not.toMatch(
      /bearer-secret|credential-secret|private stderr|X-Amz/i,
    );
    log.mockRestore();
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    const [session] = await dataSource.query<{ state: string }[]>(
      'SELECT state FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    expect(session.state).toBe('completing');
  });

  it('aborts a completing session when the stored object size diverges', async () => {
    const { sessionId } = await seedSession('completing', false);
    storage.headObject.mockResolvedValueOnce({
      ContentLength: 1,
      $metadata: {},
    });

    await expect(reconciler.reconcileCompleting()).resolves.toBe(0);

    const [session] = await dataSource.query<
      { state: string; last_error_code: string }[]
    >('SELECT state,last_error_code FROM video_upload_sessions WHERE id=$1', [
      sessionId,
    ]);
    expect(session).toMatchObject({
      state: 'aborted',
      last_error_code: 'UPLOAD_SIZE_MISMATCH',
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it.each([
    { expired: false, expectedState: 'uploading' },
    { expired: true, expectedState: 'expired' },
  ])(
    'returns incomplete multipart to $expectedState according to database TTL',
    async ({ expired, expectedState }) => {
      const { sessionId } = await seedSession('completing', expired);
      storage.headObject.mockRejectedValueOnce({
        $metadata: { httpStatusCode: 404 },
      });
      storage.listParts.mockResolvedValueOnce([
        { PartNumber: 1, Size: 67_108_864, ETag: 'one' },
      ]);

      await expect(reconciler.reconcileCompleting()).resolves.toBe(0);

      const [session] = await dataSource.query<{ state: string }[]>(
        'SELECT state FROM video_upload_sessions WHERE id=$1',
        [sessionId],
      );
      expect(session.state).toBe(expectedState);
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    },
  );

  it('aborts without an event when both object and multipart are absent', async () => {
    const { sessionId } = await seedSession('completing', false);
    storage.headObject.mockRejectedValueOnce({
      $metadata: { httpStatusCode: 404 },
    });
    storage.listParts.mockRejectedValueOnce({
      $metadata: { httpStatusCode: 404 },
    });

    await expect(reconciler.reconcileCompleting()).resolves.toBe(0);

    const [session] = await dataSource.query<
      { state: string; last_error_code: string }[]
    >('SELECT state,last_error_code FROM video_upload_sessions WHERE id=$1', [
      sessionId,
    ]);
    expect(session).toMatchObject({
      state: 'aborted',
      last_error_code: 'UPLOAD_STORAGE_MISSING',
    });
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_processing_outbox',
    );
    expect(Number(count)).toBe(0);
  });

  it('does not finalize after losing the completing lease', async () => {
    const { sessionId } = await seedSession('completing', false);
    storage.headObject.mockImplementationOnce(async () => {
      await dataSource.query(
        `UPDATE video_upload_sessions
         SET operation_token=$2,operation_until=now()+interval '2 minutes'
         WHERE id=$1`,
        [sessionId, randomUUID()],
      );
      return { ContentLength: 67_108_865, $metadata: {} };
    });

    await expect(reconciler.reconcileCompleting()).resolves.toBe(0);

    const [session] = await dataSource.query<{ state: string }[]>(
      'SELECT state FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    expect(session.state).toBe('completing');
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_processing_outbox',
    );
    expect(Number(count)).toBe(0);
  });

  it('revalidates every part before recovering completion', async () => {
    const { videoId } = await seedSession('completing', false);
    storage.headObject
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({
        ContentLength: 67_108_865,
        $metadata: {},
      });
    storage.listParts.mockResolvedValueOnce([
      { PartNumber: 1, Size: 67_108_864, ETag: 'one' },
      { PartNumber: 2, Size: 1, ETag: 'two' },
    ]);
    await expect(reconciler.reconcileCompleting()).resolves.toBe(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    const [video] = await dataSource.query<{ status: string }[]>(
      'SELECT status FROM videos WHERE id=$1',
      [videoId],
    );
    expect(video.status).toBe('processing');
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_processing_outbox',
    );
    expect(Number(count)).toBe(1);
  });

  it('recovers a complete accepted remotely after its response is lost', async () => {
    const { sessionId, videoId } = await seedSession('completing', false);
    storage.headObject
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({
        ContentLength: 67_108_865,
        $metadata: {},
      });
    storage.listParts.mockResolvedValueOnce([
      { PartNumber: 1, Size: 67_108_864, ETag: 'one' },
      { PartNumber: 2, Size: 1, ETag: 'two' },
    ]);
    storage.completeMultipartUpload.mockRejectedValueOnce(
      new Error('request timed out after remote acceptance'),
    );

    await expect(reconciler.reconcileCompleting()).resolves.toBe(0);
    const [ambiguous] = await dataSource.query<
      { state: string; operation_until: Date }[]
    >('SELECT state,operation_until FROM video_upload_sessions WHERE id=$1', [
      sessionId,
    ]);
    expect(ambiguous.state).toBe('completing');
    expect(ambiguous.operation_until.getTime()).toBeLessThanOrEqual(Date.now());

    await expect(reconciler.reconcileCompleting()).resolves.toBe(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    const [video] = await dataSource.query<{ status: string }[]>(
      'SELECT status FROM videos WHERE id=$1',
      [videoId],
    );
    expect(video.status).toBe('processing');
  });

  it('lets only one of two recoverers finalize a valid completion after TTL', async () => {
    const { videoId } = await seedSession('completing', true);
    storage.headObject.mockResolvedValue({
      ContentLength: 67_108_865,
      $metadata: {},
    });
    const competitor = new UploadReconcilerService(
      new UploadReconcilerRepository(dataSource),
      storage as unknown as StorageService,
      new MultipartProvisionerService(
        new VideoUploadRepository(dataSource),
        storage as unknown as StorageService,
      ),
    );

    const results = await Promise.all([
      reconciler.reconcileCompleting(),
      competitor.reconcileCompleting(),
    ]);

    expect(results[0] + results[1]).toBe(1);
    expect(storage.headObject).toHaveBeenCalledTimes(1);
    const [video] = await dataSource.query<{ status: string }[]>(
      'SELECT status FROM videos WHERE id=$1',
      [videoId],
    );
    expect(video.status).toBe('processing');
    const [{ count }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_processing_outbox',
    );
    expect(Number(count)).toBe(1);
  });

  it('persists expiry and delegates cleanup through a pending obligation', async () => {
    const first = await seedSession('uploading', true);
    await expect(reconciler.sweepExpired()).resolves.toBe(1);
    const [session] = await dataSource.query<
      {
        state: string;
        quota_released_at: Date | null;
      }[]
    >('SELECT state,quota_released_at FROM video_upload_sessions WHERE id=$1', [
      first.sessionId,
    ]);
    expect(session).toMatchObject({
      state: 'expired',
      quota_released_at: null,
    });

    const [obligation] = await dataSource.query<
      { state: string; confirmed_at: Date | null }[]
    >(
      `SELECT state,confirmed_at FROM video_cleanup_obligations
       WHERE session_id=$1`,
      [first.sessionId],
    );
    expect(obligation.state).toBe('pending');
    expect(obligation.confirmed_at).toBeNull();

    await expect(reconciler.sweepExpired()).resolves.toBe(0);
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
