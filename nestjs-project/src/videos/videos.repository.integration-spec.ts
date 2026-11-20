import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794000000000 } from '../database/migrations/1794000000000-CreateVideos';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VideoUploadSession } from './entities/video-upload-session.entity';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';

describe('VideosRepository (integration)', () => {
  let dataSource: DataSource;
  let repository: VideosRepository;
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
    repository = new VideosRepository(dataSource);
  });

  afterAll(async () => dataSource.destroy());

  beforeEach(async () => {
    await dataSource.query('DELETE FROM video_processing_outbox');
    await dataSource.query('DELETE FROM video_upload_sessions');
    await dataSource.query('DELETE FROM videos');
    await dataSource.query('DELETE FROM refresh_tokens');
    await dataSource.query('DELETE FROM verification_tokens');
    await dataSource.query('DELETE FROM channels');
    await dataSource.query('DELETE FROM users');

    const userId = randomUUID();
    channelId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id,email,password) VALUES ($1,$2,'hash')`,
      [userId, `${userId}@test.local`],
    );
    await dataSource.query(
      `INSERT INTO channels (id,name,nickname,user_id) VALUES ($1,'Test',$2,$3)`,
      [channelId, `channel-${channelId}`, userId],
    );
  });

  async function insertVideo(
    overrides: Partial<{
      status: string;
      publicId: string;
      sourceKey: string;
    }> = {},
  ): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO videos
       (id, public_id, channel_id, title, original_filename, status, size_bytes, source_key)
       VALUES ($1,$2,$3,'Video','video.mp4',$4,67108864,$5)`,
      [
        id,
        overrides.publicId ?? randomUUID().replaceAll('-', '').slice(0, 22),
        channelId,
        overrides.status ?? 'draft',
        overrides.sourceKey ?? `videos/${id}/source.mp4`,
      ],
    );
    return id;
  }

  it('enforces public/source uniqueness and terminal status checks', async () => {
    const publicId = 'a'.repeat(22);
    const sourceKey = 'videos/source.mp4';
    await insertVideo({ publicId, sourceKey });

    await expect(insertVideo({ publicId })).rejects.toThrow();
    await expect(insertVideo({ sourceKey })).rejects.toThrow();
    await expect(insertVideo({ status: 'ready' })).rejects.toThrow();
    await expect(insertVideo({ status: 'error' })).rejects.toThrow();
  });

  it('requires matching video/channel ownership and unique idempotency', async () => {
    const videoId = await insertVideo();
    const idempotencyKey = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    const insert = (sessionChannelId: string, key = idempotencyKey) =>
      dataSource.query(
        `INSERT INTO video_upload_sessions
         (video_id,channel_id,idempotency_key,request_hash,state,expected_parts,expires_at)
         VALUES ($1,$2,$3,$4,'initiating',1,$5)`,
        [videoId, sessionChannelId, key, 'b'.repeat(64), expiresAt],
      );

    await expect(insert(randomUUID())).rejects.toThrow();
    await insert(channelId);

    const secondVideoId = await insertVideo();
    await expect(
      dataSource.query(
        `INSERT INTO video_upload_sessions
         (video_id,channel_id,idempotency_key,request_hash,state,expected_parts,expires_at)
         VALUES ($1,$2,$3,$4,'initiating',1,$5)`,
        [secondVideoId, channelId, idempotencyKey, 'c'.repeat(64), expiresAt],
      ),
    ).rejects.toThrow();
  });

  it('allows only one concurrent processing claim', async () => {
    const videoId = await insertVideo({ status: 'processing' });
    const [first, second] = await Promise.all([
      repository.claimProcessing(videoId),
      repository.claimProcessing(videoId),
    ]);
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.processing_attempts).toBe(1);
    expect(await repository.heartbeat(videoId, winners[0]!.attempt_id!)).toBe(
      true,
    );
  });

  it('reactivates cleanup without releasing quota on the third failed attempt', async () => {
    const videoId = await insertVideo({ status: 'processing' });
    const sessionId = randomUUID();
    await dataSource.query(
      `INSERT INTO video_upload_sessions
       (id,video_id,channel_id,idempotency_key,request_hash,state,expected_parts,expires_at)
       VALUES ($1,$2,$3,$4,$5,'completed',1,now())`,
      [sessionId, videoId, channelId, randomUUID(), 'd'.repeat(64)],
    );
    const claimed = await repository.claimProcessing(videoId);
    await dataSource.query(
      'UPDATE videos SET processing_attempts=3 WHERE id=$1',
      [videoId],
    );

    await expect(
      repository.recordProcessingFailure(
        videoId,
        claimed!.attempt_id!,
        false,
        'PROCESSING_FAILED',
      ),
    ).resolves.toBe('error');

    const [row] = await dataSource.query<
      {
        quota_released_at: Date | null;
        cleanup_state: string;
      }[]
    >(
      `SELECT session.quota_released_at,obligation.state cleanup_state
       FROM video_upload_sessions session
       JOIN video_cleanup_obligations obligation ON obligation.session_id=session.id
       WHERE session.id=$1`,
      [sessionId],
    );
    expect(row.quota_released_at).toBeNull();
    expect(row.cleanup_state).toBe('pending');
  });

  it('fences the ready CAS with the persisted total deadline', async () => {
    const videoId = await insertVideo({ status: 'processing' });
    const claimed = await repository.claimProcessing(videoId);
    expect(claimed?.attempt_id).toBeTruthy();
    const metadata = {
      format: 'mp4',
      videoCodec: 'h264',
      audioCodec: null,
      width: 320,
      height: 240,
      fps: { numerator: 25, denominator: 1 },
    };

    await expect(
      repository.markReady(
        videoId,
        claimed!.attempt_id!,
        1000,
        metadata,
        'stream.mp4',
        'thumbnail.jpg',
        new Date(Date.now() - 1),
      ),
    ).resolves.toBe(false);
    await expect(
      repository.markReady(
        videoId,
        claimed!.attempt_id!,
        1000,
        metadata,
        'stream.mp4',
        'thumbnail.jpg',
        new Date(Date.now() + 60_000),
      ),
    ).resolves.toBe(true);
  });

  it('returns the persisted failure state from UPDATE RETURNING', async () => {
    const videoId = await insertVideo({ status: 'processing' });
    const first = await repository.claimProcessing(videoId);
    await expect(
      repository.recordProcessingFailure(
        videoId,
        first!.attempt_id!,
        false,
        'PROCESSING_FAILED',
      ),
    ).resolves.toBe('processing');
    await dataSource.query(
      `UPDATE videos SET processing_next_attempt_at=now()-interval '1 second'
       WHERE id=$1`,
      [videoId],
    );
    const second = await repository.claimProcessing(videoId);
    await expect(
      repository.recordProcessingFailure(
        videoId,
        second!.attempt_id!,
        true,
        'INVALID_VIDEO',
      ),
    ).resolves.toBe('error');
  });
});
