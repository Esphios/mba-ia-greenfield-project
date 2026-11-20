import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { CleanupCoordinatorService } from './cleanup-coordinator.service';
import { CleanupObligationRepository } from './cleanup-obligation.repository';
import { VideoStatus } from './entities/video.entity';
import { VideoUploadState } from './entities/video-upload-session.entity';
import { VideoScratchService } from './video-scratch.service';

describe('CleanupCoordinatorService (PostgreSQL + MinIO integration)', () => {
  const workDirectory = `/tmp/cleanup-coordinator-${process.pid}`;
  const storage = new StorageService({
    backend: 'minio',
    internalEndpoint: process.env.S3_INTERNAL_ENDPOINT!,
    publicEndpoint: process.env.S3_INTERNAL_ENDPOINT!,
    region: process.env.S3_REGION!,
    bucket: process.env.S3_BUCKET!,
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: true,
    allowedOrigins: [],
    connectTimeoutMs: 5_000,
    controlTimeoutMs: 30_000,
    completeTimeoutMs: 120_000,
  } as ConfigType<typeof storageConfig>);
  const prefixes = new Set<string>();
  let source: DataSource;
  let coordinator: CleanupCoordinatorService;

  beforeAll(async () => {
    source = await createTestDataSource([]).initialize();
    await cleanAllTables(source);
    const repository = new CleanupObligationRepository(source);
    const scratch = new VideoScratchService({
      workDirectory,
    } as ConfigType<typeof videoConfig>);
    coordinator = new CleanupCoordinatorService(repository, storage, scratch);
  });

  afterEach(async () => {
    await cleanAllTables(source);
    for (const prefix of prefixes) {
      for (const upload of await storage.listMultipartUploads(prefix)) {
        if (upload.Key && upload.UploadId)
          await storage.abortMultipartUpload(upload.Key, upload.UploadId);
      }
      for (const key of await storage.listObjectKeys(prefix))
        await storage.deleteObject(key);
    }
    prefixes.clear();
    await rm(workDirectory, { recursive: true, force: true });
  });

  afterAll(async () => source.destroy());

  async function put(key: string): Promise<void> {
    await storage.uploadStream(
      key,
      Readable.from(Buffer.from('cleanup-integration')),
      'application/octet-stream',
      1024,
    );
  }

  async function seed(
    sessionState: VideoUploadState,
    videoStatus: VideoStatus,
  ): Promise<{
    sessionId: string;
    videoId: string;
    sourceKey: string;
    streamKey: string;
    thumbnailKey: string;
    prefix: string;
  }> {
    const userId = randomUUID();
    const channelId = randomUUID();
    const videoId = randomUUID();
    const sessionId = randomUUID();
    const prefix = `videos/${videoId}/`;
    const sourceKey = `${prefix}source.mp4`;
    const streamKey = `${prefix}stream.mp4`;
    const thumbnailKey = `${prefix}thumbnail.jpg`;
    prefixes.add(prefix);
    await source.query(
      `INSERT INTO users(id,email,password,is_confirmed) VALUES($1,$2,'hash',true)`,
      [userId, `${userId}@example.test`],
    );
    await source.query(
      `INSERT INTO channels(id,name,nickname,user_id) VALUES($1,'Cleanup',$2,$3)`,
      [channelId, `cleanup-${userId}`, userId],
    );
    await source.query(
      `INSERT INTO videos(id,public_id,channel_id,title,original_filename,status,
        size_bytes,source_key,stream_key,thumbnail_key,duration_ms,metadata,failure_code)
       VALUES($1,$2,$3,'Cleanup','video.mp4',$4,1,$5,$6,$7,$8,$9,$10)`,
      [
        videoId,
        randomUUID().replaceAll('-', '').slice(0, 22),
        channelId,
        videoStatus,
        sourceKey,
        videoStatus === 'ready' ? streamKey : null,
        videoStatus === 'ready' ? thumbnailKey : null,
        videoStatus === 'ready' ? 1000 : null,
        videoStatus === 'ready'
          ? { format: 'mp4', videoCodec: 'h264', audioCodec: null }
          : null,
        videoStatus === 'error' ? 'PROCESSING_FAILED' : null,
      ],
    );
    await source.query(
      `INSERT INTO video_upload_sessions(id,video_id,channel_id,idempotency_key,
        request_hash,state,expected_parts,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,1,now()-interval '1 hour')`,
      [
        sessionId,
        videoId,
        channelId,
        randomUUID(),
        'c'.repeat(64),
        sessionState,
      ],
    );
    await source.query(
      `INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       VALUES($1,now()-interval '1 second')`,
      [sessionId],
    );
    await mkdir(join(workDirectory, videoId), { recursive: true });
    await writeFile(join(workDirectory, videoId, 'scratch.bin'), 'scratch');
    return {
      sessionId,
      videoId,
      sourceKey,
      streamKey,
      thumbnailKey,
      prefix,
    };
  }

  async function expectReleased(sessionId: string): Promise<void> {
    const [row] = await source.query<
      {
        quota_released_at: Date | null;
        state: string;
      }[]
    >(
      `SELECT session.quota_released_at,obligation.state
       FROM video_upload_sessions session
       JOIN video_cleanup_obligations obligation ON obligation.session_id=session.id
       WHERE session.id=$1`,
      [sessionId],
    );
    expect(row.quota_released_at).toBeInstanceOf(Date);
    expect(row.state).toBe('verified');
  }

  it('removes late source, multipart and scratch for an aborted session', async () => {
    const scenario = await seed('aborted', 'draft');
    await put(scenario.sourceKey);
    await storage.createMultipartUpload(
      `${scenario.prefix}attempts/late/stream.mp4`,
      'video/mp4',
    );

    await expect(coordinator.reconcileDue()).resolves.toBe(1);

    await expect(storage.listObjectKeys(scenario.prefix)).resolves.toEqual([]);
    await expect(
      storage.listMultipartUploads(scenario.prefix),
    ).resolves.toEqual([]);
    await expectReleased(scenario.sessionId);
  });

  it('preserves source and winning derivatives while deleting ready losers', async () => {
    const scenario = await seed('completed', 'ready');
    const loser = `${scenario.prefix}attempts/old/stream.mp4`;
    for (const key of [
      scenario.sourceKey,
      scenario.streamKey,
      scenario.thumbnailKey,
      loser,
    ])
      await put(key);
    await storage.createMultipartUpload(
      `${scenario.prefix}attempts/old/thumbnail.jpg`,
      'image/jpeg',
    );

    await expect(coordinator.reconcileDue()).resolves.toBe(1);

    await expect(storage.listObjectKeys(scenario.prefix)).resolves.toEqual(
      expect.arrayContaining([
        scenario.sourceKey,
        scenario.streamKey,
        scenario.thumbnailKey,
      ]),
    );
    await expect(storage.headObject(loser)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
    await expect(
      storage.listMultipartUploads(scenario.prefix),
    ).resolves.toEqual([]);
    await expectReleased(scenario.sessionId);
  });

  it('preserves only source for a completed error', async () => {
    const scenario = await seed('completed', 'error');
    const derivative = `${scenario.prefix}attempts/failed/stream.mp4`;
    await put(scenario.sourceKey);
    await put(derivative);

    await expect(coordinator.reconcileDue()).resolves.toBe(1);

    await expect(storage.listObjectKeys(scenario.prefix)).resolves.toEqual([
      scenario.sourceKey,
    ]);
    await expectReleased(scenario.sessionId);
  });

  it('keeps quota on a transient delete failure and converges next cycle', async () => {
    const scenario = await seed('expired', 'draft');
    await put(scenario.sourceKey);
    jest
      .spyOn(storage, 'deleteObject')
      .mockRejectedValueOnce(new Error('injected delete failure'));

    await expect(coordinator.reconcileDue()).resolves.toBe(0);
    let [session] = await source.query<{ quota_released_at: Date | null }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [scenario.sessionId],
    );
    expect(session.quota_released_at).toBeNull();
    await source.query(
      `UPDATE video_cleanup_obligations
       SET next_attempt_at=now()-interval '1 second' WHERE session_id=$1`,
      [scenario.sessionId],
    );

    await expect(coordinator.reconcileDue()).resolves.toBe(1);

    [session] = await source.query<{ quota_released_at: Date | null }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [scenario.sessionId],
    );
    expect(session.quota_released_at).toBeInstanceOf(Date);
    await expect(storage.listObjectKeys(scenario.prefix)).resolves.toEqual([]);
  });
});
