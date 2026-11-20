import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import videoConfig from '../../config/video.config';
import { CreateUsersAndChannels1775687773260 } from '../../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794000000000 } from '../../database/migrations/1794000000000-CreateVideos';
import { CreateVideoCleanupObligations1794000001000 } from '../../database/migrations/1794000001000-CreateVideoCleanupObligations';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { StorageService } from '../../storage/storage.service';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { VideoUploadSession } from '../entities/video-upload-session.entity';
import { Video } from '../entities/video.entity';
import { VideoCleanupObligation } from '../entities/video-cleanup-obligation.entity';
import { VideosRepository } from '../videos.repository';
import { CleanupCoordinatorService } from '../cleanup-coordinator.service';
import { CleanupObligationRepository } from '../cleanup-obligation.repository';
import { VideoScratchService } from '../video-scratch.service';
import {
  ProcessingQueueService,
  VIDEO_PROCESSING_QUEUE,
} from './processing-queue.service';
import { ProcessingRecoveryService } from './processing-recovery.service';
import { ProcessingRecoveryRepository } from './processing-recovery.repository';

describe('ProcessingRecoveryService (integration)', () => {
  let source: DataSource;
  let queue: ProcessingQueueService;
  let recovery: ProcessingRecoveryService;
  let channelId: string;
  let prefix: string;
  let storage: StorageService;
  let repository: VideosRepository;
  let cleanup: CleanupCoordinatorService;

  beforeAll(async () => {
    source = createTestDataSource(
      [
        User,
        Channel,
        Video,
        VideoUploadSession,
        VideoProcessingOutbox,
        VideoCleanupObligation,
      ],
      {
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1794000000000,
          CreateVideoCleanupObligations1794000001000,
        ],
      },
    );
    await source.initialize();
    await source.runMigrations();
    prefix = `phase03_recovery_test_${randomUUID().replaceAll('-', '')}`;
    queue = new ProcessingQueueService({
      host: process.env.REDIS_HOST ?? 'redis-test',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: undefined,
      prefix,
    });
    storage = new StorageService(storageConfig());
    repository = new VideosRepository(source);
    cleanup = new CleanupCoordinatorService(
      new CleanupObligationRepository(source),
      storage,
      new VideoScratchService({
        ...videoConfig(),
        workDirectory: '/tmp/phase03-recovery-test',
      }),
    );
    recovery = new ProcessingRecoveryService(
      new ProcessingRecoveryRepository(source),
      queue,
      storage,
      {
        ...videoConfig(),
        workDirectory: '/tmp/phase03-recovery-test',
      },
    );
  });

  afterAll(async () => {
    await queue.onModuleDestroy();
    await source.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(source);
    const userId = randomUUID();
    channelId = randomUUID();
    await source.query(
      'INSERT INTO users(id,email,password) VALUES($1,$2,$3)',
      [userId, `${userId}@test.local`, 'hash'],
    );
    await source.query(
      'INSERT INTO channels(id,name,nickname,user_id) VALUES($1,$2,$3,$4)',
      [channelId, 'Recovery', `recovery-${channelId}`, userId],
    );
  });

  async function insertProcessing(
    attempts: number,
    activeLease: boolean,
  ): Promise<string> {
    const id = randomUUID();
    await source.query(
      `INSERT INTO videos(id,public_id,channel_id,title,original_filename,status,size_bytes,source_key,processing_attempts,lease_until)
       VALUES($1,$2,$3,'Recovery','video.mp4','processing',100,$4,$5,
         CASE WHEN $6 THEN now()+interval '2 minutes' ELSE now()-interval '1 second' END)`,
      [
        id,
        randomBytes(16).toString('base64url'),
        channelId,
        `videos/${id}/source.mp4`,
        attempts,
        activeLease,
      ],
    );
    await source.query(
      `INSERT INTO video_processing_outbox(id,video_id,event_type,payload,next_attempt_at,published_at)
       VALUES($1,$2,'video.processing.requested.v1',$3,now(),now())`,
      [
        randomUUID(),
        id,
        JSON.stringify({
          eventId: randomUUID(),
          videoId: id,
          processingVersion: 1,
          occurredAt: new Date().toISOString(),
        }),
      ],
    );
    return id;
  }

  it('makes a missing job publishable again without consuming a DB attempt', async () => {
    const id = await insertProcessing(2, false);
    expect(await recovery.reconcileOnce()).toBe(1);
    const rows = await source.query<
      { processing_attempts: number; published_at: Date | null }[]
    >(
      `SELECT v.processing_attempts,o.published_at FROM videos v
       JOIN video_processing_outbox o ON o.video_id=v.id WHERE v.id=$1`,
      [id],
    );
    expect(rows[0].processing_attempts).toBe(2);
    expect(rows[0].published_at).toBeNull();
  });

  it('preserves a third active lease and terminates only after expiry', async () => {
    const id = await insertProcessing(3, true);
    const sessionId = randomUUID();
    await source.query(
      `INSERT INTO video_upload_sessions(id,video_id,channel_id,idempotency_key,
        request_hash,state,expected_parts,expires_at)
       VALUES($1,$2,$3,$4,$5,'completed',1,now())`,
      [sessionId, id, channelId, randomUUID(), 'f'.repeat(64)],
    );
    expect(await recovery.reconcileOnce()).toBe(0);
    await source.query(
      "UPDATE videos SET lease_until=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    expect(await recovery.reconcileOnce()).toBe(1);
    const rows = await source.query<
      { status: string; failure_code: string; finalized_at: Date }[]
    >(
      `SELECT v.status,v.failure_code,o.finalized_at FROM videos v
       JOIN video_processing_outbox o ON o.video_id=v.id WHERE v.id=$1`,
      [id],
    );
    expect(rows[0].status).toBe('error');
    expect(rows[0].failure_code).toBe('PROCESSING_FAILED');
    expect(rows[0].finalized_at).toBeInstanceOf(Date);
    const [cleanup] = await source.query<
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
    expect(cleanup.quota_released_at).toBeNull();
    expect(cleanup.state).toBe('pending');
  });

  it('does not spend a DB claim while a lease or backoff is active', async () => {
    const id = await insertProcessing(1, true);
    expect(await repository.claimProcessing(id)).toBeNull();
    await source.query(
      "UPDATE videos SET lease_until=NULL,processing_next_attempt_at=now()+interval '1 minute' WHERE id=$1",
      [id],
    );
    expect(await repository.claimProcessing(id)).toBeNull();
    const rows = await source.query<{ processing_attempts: number }[]>(
      'SELECT processing_attempts FROM videos WHERE id=$1',
      [id],
    );
    expect(rows[0].processing_attempts).toBe(1);
  });

  it('removes a failed transport job so the DB budget can republish it', async () => {
    const id = await insertProcessing(1, false);
    const worker = new Worker(
      VIDEO_PROCESSING_QUEUE,
      async () => {
        throw new Error('simulated transport failure');
      },
      {
        prefix,
        connection: {
          host: process.env.REDIS_HOST ?? 'redis-test',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
      },
    );
    worker.on('error', () => undefined);
    try {
      const failed = new Promise<void>((resolve) =>
        worker.once('failed', () => resolve()),
      );
      const jobId = `video-${id}-v1`;
      await queue.queue.add(
        'process-video',
        { videoId: id },
        { jobId, attempts: 1 },
      );
      await failed;
      await worker.close();
      expect(await (await queue.queue.getJob(jobId))?.getState()).toBe(
        'failed',
      );
      expect(await recovery.reconcileOnce()).toBe(1);
      expect(await queue.queue.getJob(jobId)).toBeUndefined();
      const rows = await source.query<{ published_at: Date | null }[]>(
        'SELECT published_at FROM video_processing_outbox WHERE video_id=$1',
        [id],
      );
      expect(rows[0].published_at).toBeNull();
    } finally {
      if (!worker.closing) await worker.close();
    }
  });

  it('deletes losing derivatives and releases quota while retaining ready media', async () => {
    const id = await insertProcessing(1, false);
    const winner = `videos/${id}/attempts/winner/stream.mp4`;
    const loser = `videos/${id}/attempts/loser/stream.mp4`;
    const thumbnail = `videos/${id}/attempts/winner/thumbnail.jpg`;
    const sourceKey = `videos/${id}/source.mp4`;
    for (const key of [sourceKey, winner, loser, thumbnail]) {
      await storage.uploadStream(
        key,
        Readable.from([Buffer.from('bytes')]),
        'application/octet-stream',
        100,
      );
    }
    await source.query(
      `UPDATE videos SET status='ready',duration_ms=1000,stream_key=$2,thumbnail_key=$3,
         metadata=$4,processed_at=now(),lease_until=NULL WHERE id=$1`,
      [
        id,
        winner,
        thumbnail,
        JSON.stringify({
          format: 'mp4',
          videoCodec: 'h264',
          audioCodec: null,
          width: 320,
          height: 240,
          fps: { numerator: 25, denominator: 1 },
        }),
      ],
    );
    const sessionId = randomUUID();
    await source.query(
      `INSERT INTO video_upload_sessions(id,video_id,channel_id,idempotency_key,request_hash,state,expected_parts,expires_at)
       VALUES($1,$2,$3,$4,$5,'completed',1,now())`,
      [sessionId, id, channelId, randomUUID(), 'a'.repeat(64)],
    );
    await source.query(
      `INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       VALUES($1,now()) ON CONFLICT(session_id) DO UPDATE SET next_attempt_at=now(),
         lock_token=NULL,locked_until=NULL`,
      [sessionId],
    );
    expect(await cleanup.reconcileDue()).toBe(1);
    expect(
      (await storage.listObjectKeys(`videos/${id}/attempts/`)).sort(),
    ).toEqual([thumbnail, winner].sort());
    expect((await storage.headObject(sourceKey)).ContentLength).toBe(5);
    const rows = await source.query<{ quota_released_at: Date | null }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    expect(rows[0].quota_released_at).toBeInstanceOf(Date);
    const [obligation] = await source.query<
      { state: string; confirmed_at: Date | null }[]
    >(
      `SELECT state,confirmed_at FROM video_cleanup_obligations
       WHERE session_id=$1`,
      [sessionId],
    );
    expect(obligation.state).toBe('verified');
    expect(obligation.confirmed_at).toBeInstanceOf(Date);
    expect(await cleanup.reconcileDue()).toBe(0);
  });

  it('rechecks historically released sessions and removes late objects and multiparts', async () => {
    const id = await insertProcessing(3, false);
    const sourceKey = `videos/${id}/source.mp4`;
    const loser = `videos/${id}/attempts/loser/stream.mp4`;
    await storage.uploadStream(
      sourceKey,
      Readable.from([Buffer.from('source')]),
      'video/mp4',
      100,
    );
    await storage.uploadStream(
      loser,
      Readable.from([Buffer.from('loser')]),
      'video/mp4',
      100,
    );
    await source.query(
      `UPDATE videos SET status='error',failure_code='PROCESSING_FAILED',
       lease_until=NULL WHERE id=$1`,
      [id],
    );
    const sessionId = randomUUID();
    await source.query(
      `INSERT INTO video_upload_sessions(id,video_id,channel_id,idempotency_key,
        request_hash,state,expected_parts,expires_at,quota_released_at)
       VALUES($1,$2,$3,$4,$5,'completed',1,now(),now()-interval '1 day')`,
      [sessionId, id, channelId, randomUUID(), 'b'.repeat(64)],
    );
    await source.query(
      `INSERT INTO video_cleanup_obligations
        (session_id,state,next_attempt_at,confirmed_at)
       VALUES($1,'verified',now()-interval '1 second',now()-interval '1 day')`,
      [sessionId],
    );
    await storage.createMultipartUpload(sourceKey, 'video/mp4');
    await storage.createMultipartUpload(
      `videos/${id}/attempts/late/stream.mp4`,
      'video/mp4',
    );
    const [before] = await source.query<{ quota_released_at: Date }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );

    expect(await cleanup.reconcileDue()).toBe(1);
    expect(await storage.listObjectKeys(`videos/${id}/attempts/`)).toEqual([]);
    expect(await storage.listMultipartUploads(`videos/${id}/`)).toEqual([]);
    await expect(storage.headObject(sourceKey)).resolves.toMatchObject({
      ContentLength: 6,
    });

    const lateKey = `videos/${id}/attempts/late-after-confirm/thumbnail.jpg`;
    await storage.uploadStream(
      lateKey,
      Readable.from([Buffer.from('late')]),
      'image/jpeg',
      100,
    );
    await source.query(
      `UPDATE video_cleanup_obligations
       SET next_attempt_at=now()-interval '1 second' WHERE session_id=$1`,
      [sessionId],
    );
    expect(await cleanup.reconcileDue()).toBe(1);
    await expect(storage.headObject(lateKey)).rejects.toMatchObject({
      name: 'NotFound',
    });
    const [after] = await source.query<{ quota_released_at: Date }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    expect(after.quota_released_at).toEqual(before.quota_released_at);
  });

  it('cleans 24-hour orphan objects without deleting the current attempt', async () => {
    const id = await insertProcessing(1, false);
    const current = randomUUID();
    const oldKey = `videos/${id}/attempts/${randomUUID()}/stream.mp4`;
    const currentKey = `videos/${id}/attempts/${current}/stream.mp4`;
    await source.query(
      `UPDATE videos SET attempt_id=$2,updated_at=now()-interval '25 hours' WHERE id=$1`,
      [id, current],
    );
    for (const key of [oldKey, currentKey]) {
      await storage.uploadStream(
        key,
        Readable.from([Buffer.from('bytes')]),
        'application/octet-stream',
        100,
      );
    }
    expect(await recovery.cleanAbandonedAttempts()).toBe(1);
    expect(await storage.listObjectKeys(`videos/${id}/attempts/`)).toEqual([
      currentKey,
    ]);
  });
});
