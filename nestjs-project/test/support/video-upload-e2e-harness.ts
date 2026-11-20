import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Queue } from 'bullmq';
import * as argon2 from 'argon2';
import { AppModule } from '../../src/app.module';
import { configureHttpApplication } from '../../src/bootstrap/configure-http-application';
import {
  assertConnectedTestDatabase,
  validateTestDatabaseTarget,
} from '../../src/test/test-database-safety';
import { StorageService } from '../../src/storage/storage.service';
import { VIDEO_PROCESSING_QUEUE } from '../../src/videos/processing/processing-queue.service';
import { UploadReconcilerService } from '../../src/videos/upload-reconciler.service';
import { UploadReconcilerRepository } from '../../src/videos/upload-reconciler.repository';
import { VideoUploadRepository } from '../../src/videos/video-upload.repository';
import { MultipartProvisionerService } from '../../src/videos/multipart-provisioner.service';
import { CleanupCoordinatorService } from '../../src/videos/cleanup-coordinator.service';

export interface VideoE2eActor {
  userId: string;
  channelId: string;
  token: string;
}

export interface VideoE2eUploadRow {
  video_id: string;
  source_key: string;
  state: string;
  quota_released_at: Date | null;
  expires_at: Date;
}

export interface VideoE2eHarness {
  app: INestApplication<App>;
  dataSource: DataSource;
  storage: StorageService;
  queue: Queue;
  reconciler: UploadReconcilerService;
  runExpirationMaintenance(): Promise<void>;
  createActor(password?: string): Promise<VideoE2eActor>;
  createUpload(
    actor: VideoE2eActor,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ publicId: string; id: string; key: string }>;
  putSignedPart(url: string, bytes: Buffer): Promise<number>;
  dbClock(): Promise<Date>;
  outboxCount(videoId?: string): Promise<number>;
  uploadRow(publicId: string): Promise<VideoE2eUploadRow>;
  multipartUploads(publicId: string): Promise<number>;
  cleanActors(actors: VideoE2eActor[]): Promise<void>;
  close(): Promise<void>;
}

export async function createVideoE2eHarness(
  queuePrefixOverride?: string,
): Promise<VideoE2eHarness> {
  const { database } = validateTestDatabaseTarget(process.env);
  const priorPrefix = process.env.VIDEO_QUEUE_PREFIX;
  const queuePrefix =
    queuePrefixOverride ??
    `${priorPrefix ?? 'video_e2e_test'}_${randomUUID().replaceAll('-', '')}`;
  process.env.VIDEO_QUEUE_PREFIX = queuePrefix;
  let app: INestApplication<App>;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      bodyParser: false,
    });
    configureHttpApplication(app);
    await app.listen(0);
  } finally {
    if (priorPrefix === undefined) delete process.env.VIDEO_QUEUE_PREFIX;
    else process.env.VIDEO_QUEUE_PREFIX = priorPrefix;
  }

  const dataSource = app.get(DataSource);
  await assertConnectedTestDatabase(
    dataSource.query.bind(dataSource),
    database,
    process.env.DB_USERNAME!,
  );
  const storage = app.get(StorageService);
  const queue = new Queue(VIDEO_PROCESSING_QUEUE, {
    prefix: queuePrefix,
    connection: {
      host: process.env.REDIS_HOST ?? 'redis-test',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    },
  });
  const reconciler = new UploadReconcilerService(
    new UploadReconcilerRepository(dataSource),
    storage,
    new MultipartProvisionerService(
      new VideoUploadRepository(dataSource),
      storage,
    ),
  );
  const jwt = app.get(JwtService);
  const cleanup = app.get(CleanupCoordinatorService);

  return {
    app,
    dataSource,
    storage,
    queue,
    reconciler,
    async runExpirationMaintenance(): Promise<void> {
      await reconciler.sweepExpired();
      await cleanup.reconcileDue();
    },
    async putSignedPart(url: string, bytes: Buffer): Promise<number> {
      const signed = new URL(url);
      const internal = new URL(process.env.S3_INTERNAL_ENDPOINT!);
      return new Promise<number>((resolve, reject) => {
        const outgoing = httpRequest(
          {
            hostname: internal.hostname,
            port: internal.port,
            path: `${signed.pathname}${signed.search}`,
            method: 'PUT',
            headers: {
              Host: signed.host,
              'Content-Length': bytes.byteLength,
            },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode ?? 0));
          },
        );
        outgoing.on('error', reject);
        outgoing.end(bytes);
      });
    },
    async dbClock(): Promise<Date> {
      const [{ db_now: now }] = await dataSource.query<{ db_now: Date }[]>(
        'SELECT clock_timestamp() AS db_now',
      );
      return now;
    },
    async outboxCount(videoId?: string): Promise<number> {
      const [{ count }] = await dataSource.query<{ count: string }[]>(
        `SELECT count(*)::text AS count FROM video_processing_outbox
         WHERE ($1::uuid IS NULL OR video_id=$1)`,
        [videoId ?? null],
      );
      return Number(count);
    },
    async uploadRow(publicId: string): Promise<VideoE2eUploadRow> {
      const [row] = await dataSource.query<VideoE2eUploadRow[]>(
        `SELECT v.id AS video_id,v.source_key,s.state,s.quota_released_at,s.expires_at
         FROM videos v JOIN video_upload_sessions s ON s.video_id=v.id
         WHERE v.public_id=$1`,
        [publicId],
      );
      if (!row) throw new Error(`Missing video upload ${publicId}`);
      return row;
    },
    async multipartUploads(publicId: string): Promise<number> {
      const { source_key: key } = await this.uploadRow(publicId);
      const uploads = await storage.listMultipartUploads(key);
      return uploads.filter((upload) => upload.Key === key).length;
    },
    async createActor(password?: string): Promise<VideoE2eActor> {
      const userId = randomUUID();
      const channelId = randomUUID();
      const email = `${userId}@video-e2e.test`;
      const passwordHash = password ? await argon2.hash(password) : 'hash';
      await dataSource.query(
        `INSERT INTO users(id,email,password,is_confirmed)
         VALUES($1,$2,$3,true)`,
        [userId, email, passwordHash],
      );
      await dataSource.query(
        `INSERT INTO channels(id,name,nickname,user_id)
         VALUES($1,'Video E2E',$2,$3)`,
        [channelId, `video-e2e-${userId}`, userId],
      );
      const token = await jwt.signAsync({ sub: userId, email });
      return { userId, channelId, token };
    },
    async createUpload(
      actor: VideoE2eActor,
      body: Record<string, unknown> = {
        title: 'Video E2E',
        filename: 'video.mp4',
        sizeBytes: 1,
        contentType: 'video/mp4',
      },
      idempotencyKey = randomUUID(),
    ): Promise<{ publicId: string; id: string; key: string }> {
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      return {
        publicId: response.body.video.publicId as string,
        id: response.body.video.id as string,
        key: idempotencyKey,
      };
    },
    async cleanActors(actors: VideoE2eActor[]): Promise<void> {
      if (actors.length === 0) return;
      await assertConnectedTestDatabase(
        dataSource.query.bind(dataSource),
        database,
        process.env.DB_USERNAME!,
      );
      const actorIds = actors.map((actor) => actor.userId);
      const sources = await dataSource.query<
        {
          source_key: string;
          stream_key: string | null;
          thumbnail_key: string | null;
        }[]
      >(
        `SELECT v.source_key,v.stream_key,v.thumbnail_key FROM videos v
         JOIN channels c ON c.id=v.channel_id
         WHERE c.user_id=ANY($1)`,
        [actorIds],
      );
      for (const {
        source_key: sourceKey,
        stream_key: streamKey,
        thumbnail_key: thumbnailKey,
      } of sources) {
        const uploads = await storage.listMultipartUploads(sourceKey);
        for (const upload of uploads) {
          if (upload.Key === sourceKey && upload.UploadId) {
            await storage.abortMultipartUpload(sourceKey, upload.UploadId);
          }
        }
        await storage.deleteObject(sourceKey);
        if (streamKey) await storage.deleteObject(streamKey);
        if (thumbnailKey) await storage.deleteObject(thumbnailKey);
      }
      await dataSource.query(
        `DELETE FROM video_processing_outbox WHERE video_id IN
         (SELECT v.id FROM videos v JOIN channels c ON c.id=v.channel_id
          WHERE c.user_id=ANY($1))`,
        [actorIds],
      );
      await dataSource.query(
        `DELETE FROM video_upload_sessions WHERE channel_id IN
         (SELECT id FROM channels WHERE user_id=ANY($1))`,
        [actorIds],
      );
      await dataSource.query(
        `DELETE FROM videos WHERE channel_id IN
         (SELECT id FROM channels WHERE user_id=ANY($1))`,
        [actorIds],
      );
      await dataSource.query(
        'DELETE FROM refresh_tokens WHERE user_id=ANY($1)',
        [actorIds],
      );
      await dataSource.query(
        'DELETE FROM verification_tokens WHERE user_id=ANY($1)',
        [actorIds],
      );
      await dataSource.query('DELETE FROM channels WHERE user_id=ANY($1)', [
        actorIds,
      ]);
      await dataSource.query('DELETE FROM users WHERE id=ANY($1)', [actorIds]);
    },
    async close(): Promise<void> {
      await queue.close();
      await app.close();
    },
  };
}
