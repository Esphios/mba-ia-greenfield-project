import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794000000000 } from './migrations/1794000000000-CreateVideos';
import { CreateVideoCleanupObligations1794000001000 } from './migrations/1794000001000-CreateVideoCleanupObligations';
import { Video } from '../videos/entities/video.entity';
import { VideoUploadSession } from '../videos/entities/video-upload-session.entity';
import { VideoProcessingOutbox } from '../videos/entities/video-processing-outbox.entity';
import { createTestDataSource } from '../test/create-test-data-source';
import { randomUUID } from 'node:crypto';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
  'video_upload_sessions',
  'video_processing_outbox',
  'video_cleanup_obligations',
];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [
        User,
        Channel,
        RefreshToken,
        VerificationToken,
        Video,
        VideoUploadSession,
        VideoProcessingOutbox,
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

    await dataSource.initialize();

    for (const table of MANAGED_TABLES.toReversed()) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await dataSource.query(
      'DROP TYPE IF EXISTS "verification_tokens_type_enum" CASCADE',
    );
    await dataSource.query('DROP TABLE IF EXISTS "migrations" CASCADE');
  });

  afterAll(async () => {
    // The second test undoes the additive video migration.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('should apply all migrations and create all eight tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(4);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'video_cleanup_obligations',
      'video_processing_outbox',
      'video_upload_sessions',
      'videos',
    ]);
  });

  it('should re-run the additive cleanup migration and backfill released terminal sessions', async () => {
    const userId = randomUUID();
    const channelId = randomUUID();
    const videoId = randomUUID();
    const sessionId = randomUUID();
    await dataSource.query(
      `INSERT INTO users(id,email,password) VALUES($1,$2,'hash')`,
      [userId, `${userId}@migration.test`],
    );
    await dataSource.query(
      `INSERT INTO channels(id,name,nickname,user_id) VALUES($1,'Migration',$2,$3)`,
      [channelId, `migration-${userId}`, userId],
    );
    await dataSource.query(
      `INSERT INTO videos(id,public_id,channel_id,title,original_filename,size_bytes,source_key)
       VALUES($1,$2,$3,'Migration','video.mp4',1,$4)`,
      [
        videoId,
        randomUUID().replaceAll('-', '').slice(0, 22),
        channelId,
        `videos/${videoId}/source.mp4`,
      ],
    );
    await dataSource.query(
      `INSERT INTO video_upload_sessions(id,video_id,channel_id,idempotency_key,
        request_hash,state,expected_parts,expires_at,quota_released_at)
       VALUES($1,$2,$3,$4,$5,'aborted',1,now(),now()-interval '1 hour')`,
      [sessionId, videoId, channelId, randomUUID(), 'a'.repeat(64)],
    );
    await dataSource.query(
      'DELETE FROM video_cleanup_obligations WHERE session_id=$1',
      [sessionId],
    );

    const migration = new CreateVideoCleanupObligations1794000001000();
    const runner = dataSource.createQueryRunner();
    await migration.up(runner);
    await migration.up(runner);
    await runner.release();

    const [row] = await dataSource.query<
      { state: string; quota_released_at: Date | null }[]
    >(
      `SELECT o.state,s.quota_released_at FROM video_cleanup_obligations o
       JOIN video_upload_sessions s ON s.id=o.session_id WHERE o.session_id=$1`,
      [sessionId],
    );
    expect(row.state).toBe('pending');
    expect(row.quota_released_at).toBeInstanceOf(Date);

    await dataSource.query('DELETE FROM videos WHERE id=$1', [videoId]);
    await dataSource.query('DELETE FROM channels WHERE id=$1', [channelId]);
    await dataSource.query('DELETE FROM users WHERE id=$1', [userId]);
  });

  it('should revert cleanup obligations without removing video or auth tables', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['video_cleanup_obligations']],
    );
    expect(result).toHaveLength(0);

    const existingTables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [
        [
          'users',
          'channels',
          'refresh_tokens',
          'verification_tokens',
          'videos',
          'video_upload_sessions',
          'video_processing_outbox',
        ],
      ],
    );
    expect(existingTables).toHaveLength(7);
  });
});
