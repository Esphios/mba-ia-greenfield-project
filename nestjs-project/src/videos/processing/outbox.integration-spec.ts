import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import type queueConfig from '../../config/queue.config';
import { CreateUsersAndChannels1775687773260 } from '../../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794000000000 } from '../../database/migrations/1794000000000-CreateVideos';
import { createTestDataSource } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { VideoUploadSession } from '../entities/video-upload-session.entity';
import { Video } from '../entities/video.entity';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { ProcessingQueueService } from './processing-queue.service';
import { OutboxRepository } from './outbox.repository';

describe('outbox dispatcher (integration)', () => {
  let dataSource: DataSource;
  let queue: ProcessingQueueService;
  let dispatcher: OutboxDispatcherService;

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
    queue = new ProcessingQueueService({
      host: process.env.REDIS_HOST!,
      port: Number(process.env.REDIS_PORT),
      password: undefined,
      prefix: process.env.VIDEO_QUEUE_PREFIX!,
    } as ReturnType<typeof queueConfig>);
    dispatcher = new OutboxDispatcherService(
      new OutboxRepository(dataSource),
      queue,
    );
  });

  afterAll(async () => {
    await queue.queue.obliterate({ force: true });
    await queue.onModuleDestroy();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await queue.queue.obliterate({ force: true });
    await dataSource.query('DELETE FROM video_processing_outbox');
    await dataSource.query('DELETE FROM video_upload_sessions');
    await dataSource.query('DELETE FROM videos');
    await dataSource.query('DELETE FROM channels');
    await dataSource.query('DELETE FROM refresh_tokens');
    await dataSource.query('DELETE FROM verification_tokens');
    await dataSource.query('DELETE FROM users');
  });

  async function createEvent(): Promise<{ eventId: string; videoId: string }> {
    const userId = randomUUID();
    const channelId = randomUUID();
    const videoId = randomUUID();
    const eventId = randomUUID();
    await dataSource.query(
      `INSERT INTO users(id,email,password) VALUES($1,$2,'hash')`,
      [userId, `${userId}@test.local`],
    );
    await dataSource.query(
      `INSERT INTO channels(id,name,nickname,user_id) VALUES($1,'Test',$2,$3)`,
      [channelId, `channel-${channelId}`, userId],
    );
    await dataSource.query(
      `INSERT INTO videos
       (id,public_id,channel_id,title,original_filename,status,size_bytes,source_key)
       VALUES($1,$2,$3,'Video','video.mp4','processing',1,$4)`,
      [
        videoId,
        randomUUID().replaceAll('-', '').slice(0, 22),
        channelId,
        `videos/${videoId}/source.mp4`,
      ],
    );
    const payload = {
      eventId,
      videoId,
      processingVersion: 1,
      occurredAt: new Date().toISOString(),
    };
    await dataSource.query(
      `INSERT INTO video_processing_outbox(id,video_id,event_type,payload,next_attempt_at)
       VALUES($1,$2,'video.processing.requested.v1',$3,now())`,
      [eventId, videoId, JSON.stringify(payload)],
    );
    return { eventId, videoId };
  }

  it('publishes an outbox event and records acknowledgement', async () => {
    const { eventId, videoId } = await createEvent();
    await expect(dispatcher.dispatchOnce()).resolves.toBe(1);
    await expect(
      queue.queue.getJob(`video-${videoId}-v1`),
    ).resolves.toBeDefined();
    const [event] = await dataSource.query<{ published_at: Date }[]>(
      'SELECT published_at FROM video_processing_outbox WHERE id=$1',
      [eventId],
    );
    expect(event.published_at).toBeInstanceOf(Date);
  });

  it('deduplicates a crash after publish and before DB acknowledgement', async () => {
    const { videoId } = await createEvent();
    const jobId = `video-${videoId}-v1`;
    await queue.queue.add('process-video', { videoId }, { jobId });
    await expect(dispatcher.dispatchOnce()).resolves.toBe(1);
    expect(await queue.queue.getJobs()).toHaveLength(1);
    expect((await queue.queue.getJob(jobId))?.id).toBe(jobId);
  });

  it('keeps the event pending when Redis is unavailable', async () => {
    const { eventId, videoId } = await createEvent();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const synthetic = Object.assign(
      new Error(
        'token=bearer-secret https://storage/object?X-Amz-Signature=signed-secret',
      ),
      {
        code: 'QUEUE_UNAVAILABLE',
        credential: 'access-key-secret',
        stderr: 'ffmpeg secret stderr',
      },
    );
    const add = jest.spyOn(queue.queue, 'add').mockRejectedValueOnce(synthetic);
    await expect(dispatcher.dispatchOnce()).resolves.toBe(0);
    const serializedLog = JSON.stringify(log.mock.calls);
    expect(serializedLog).toContain('video_outbox_publish_deferred');
    expect(serializedLog).toContain('QUEUE_UNAVAILABLE');
    expect(serializedLog).not.toMatch(
      /bearer-secret|signed-secret|access-key-secret|ffmpeg secret stderr|X-Amz/i,
    );
    log.mockRestore();
    const [event] = await dataSource.query<
      {
        published_at: Date | null;
        publish_attempts: number;
      }[]
    >(
      'SELECT published_at,publish_attempts FROM video_processing_outbox WHERE id=$1',
      [eventId],
    );
    expect(event).toMatchObject({ published_at: null, publish_attempts: 1 });
    const [video] = await dataSource.query<{ processing_attempts: number }[]>(
      'SELECT processing_attempts FROM videos WHERE id=$1',
      [videoId],
    );
    expect(video.processing_attempts).toBe(0);

    await dataSource.query(
      'UPDATE video_processing_outbox SET next_attempt_at=now() WHERE id=$1',
      [eventId],
    );
    add.mockRestore();
    await expect(dispatcher.dispatchOnce()).resolves.toBe(1);
    await expect(queue.queue.getJobs()).resolves.toHaveLength(1);
    const [recovered] = await dataSource.query<
      { published_at: Date | null; publish_attempts: number }[]
    >(
      `SELECT published_at,publish_attempts FROM video_processing_outbox
       WHERE id=$1`,
      [eventId],
    );
    expect(recovered.published_at).toBeInstanceOf(Date);
    expect(recovered.publish_attempts).toBe(1);
  });

  it.each([
    [0, 1, 5],
    [6, 7, 300],
    [60, 61, 300],
    [2_147_483_647, 2_147_483_647, 300],
  ])(
    'caps backoff arithmetic from publish counter %i',
    async (initial, expectedCounter, expectedDelay) => {
      const { eventId } = await createEvent();
      await dataSource.query(
        `UPDATE video_processing_outbox
       SET publish_attempts=$2
       WHERE id=$1`,
        [eventId, initial],
      );
      jest
        .spyOn(queue.queue, 'add')
        .mockRejectedValueOnce(new Error('offline'));

      await expect(dispatcher.dispatchOnce()).resolves.toBe(0);

      const [event] = await dataSource.query<
        { publish_attempts: number; delay_seconds: number }[]
      >(
        `SELECT publish_attempts,
              extract(epoch FROM (next_attempt_at-now()))::integer delay_seconds
       FROM video_processing_outbox WHERE id=$1`,
        [eventId],
      );
      expect(event.publish_attempts).toBe(expectedCounter);
      expect(event.delay_seconds).toBeGreaterThanOrEqual(expectedDelay - 2);
      expect(event.delay_seconds).toBeLessThanOrEqual(expectedDelay);
    },
  );
});
