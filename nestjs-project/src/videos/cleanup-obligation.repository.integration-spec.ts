import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { CleanupObligationRepository } from './cleanup-obligation.repository';

describe('CleanupObligationRepository (integration)', () => {
  let source: DataSource;
  let repository: CleanupObligationRepository;
  let userId: string | undefined;

  beforeAll(async () => {
    source = await createTestDataSource([]).initialize();
    await cleanAllTables(source);
    repository = new CleanupObligationRepository(source);
  });

  afterEach(async () => {
    if (!userId) return;
    await source.query(
      `DELETE FROM videos WHERE channel_id IN
       (SELECT id FROM channels WHERE user_id=$1)`,
      [userId],
    );
    await source.query('DELETE FROM channels WHERE user_id=$1', [userId]);
    await source.query('DELETE FROM users WHERE id=$1', [userId]);
    userId = undefined;
  });

  afterAll(async () => source.destroy());

  async function seedTerminalSessions(): Promise<string[]> {
    userId = randomUUID();
    const channelId = randomUUID();
    await source.query(
      `INSERT INTO users(id,email,password,is_confirmed) VALUES($1,$2,'hash',true)`,
      [userId, `${userId}@example.test`],
    );
    await source.query(
      `INSERT INTO channels(id,name,nickname,user_id) VALUES($1,'Cleanup',$2,$3)`,
      [channelId, `cleanup-${userId}`, userId],
    );
    const sessionIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const videoId = randomUUID();
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      await source.query(
        `INSERT INTO videos(id,public_id,channel_id,title,original_filename,status,
          size_bytes,source_key) VALUES($1,$2,$3,'Cleanup','video.mp4','draft',1,$4)`,
        [
          videoId,
          randomUUID().replaceAll('-', '').slice(0, 22),
          channelId,
          `videos/${videoId}/source.mp4`,
        ],
      );
      await source.query(
        `INSERT INTO video_upload_sessions(id,video_id,channel_id,idempotency_key,
          request_hash,state,expected_parts,expires_at,quota_released_at)
         VALUES($1,$2,$3,$4,$5,'aborted',1,now()-interval '1 hour',now()-interval '30 minutes')`,
        [sessionId, videoId, channelId, randomUUID(), 'a'.repeat(64)],
      );
      await source.query(
        `INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
         VALUES($1,now()-($2::text || ' seconds')::interval)`,
        [sessionId, 3 - index],
      );
    }
    return sessionIds;
  }

  async function seedCleanupScenario(
    sessionState: 'aborted' | 'expired' | 'completed',
    videoStatus: 'draft' | 'processing' | 'ready' | 'error',
    quotaReleased: boolean,
  ): Promise<{ sessionId: string; videoId: string; sourceKey: string }> {
    if (!userId) {
      userId = randomUUID();
      await source.query(
        `INSERT INTO users(id,email,password,is_confirmed) VALUES($1,$2,'hash',true)`,
        [userId, `${userId}@example.test`],
      );
      await source.query(
        `INSERT INTO channels(id,name,nickname,user_id) VALUES($1,'Cleanup',$2,$3)`,
        [randomUUID(), `cleanup-${userId}`, userId],
      );
    }
    const [{ id: channelId }] = await source.query<{ id: string }[]>(
      'SELECT id FROM channels WHERE user_id=$1',
      [userId],
    );
    const videoId = randomUUID();
    const sessionId = randomUUID();
    const sourceKey = `videos/${videoId}/source.mp4`;
    const ready = videoStatus === 'ready';
    const failed = videoStatus === 'error';
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
        ready ? `videos/${videoId}/stream.mp4` : null,
        ready ? `videos/${videoId}/thumbnail.jpg` : null,
        ready ? 1000 : null,
        ready ? { format: 'mp4', videoCodec: 'h264', audioCodec: null } : null,
        failed ? 'PROCESSING_FAILED' : null,
      ],
    );
    await source.query(
      `INSERT INTO video_upload_sessions(id,video_id,channel_id,idempotency_key,
        request_hash,state,expected_parts,expires_at,quota_released_at)
       VALUES($1,$2,$3,$4,$5,$6,1,now()-interval '1 hour',
              CASE WHEN $7 THEN now()-interval '30 minutes' ELSE NULL END)`,
      [
        sessionId,
        videoId,
        channelId,
        randomUUID(),
        'b'.repeat(64),
        sessionState,
        quotaReleased,
      ],
    );
    await source.query(
      `INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       VALUES($1,now()-interval '1 second')`,
      [sessionId],
    );
    return { sessionId, videoId, sourceKey };
  }

  it('claims terminal sessions with typed video context regardless of released quota', async () => {
    const scenarios = [
      await seedCleanupScenario('aborted', 'draft', false),
      await seedCleanupScenario('expired', 'draft', true),
      await seedCleanupScenario('completed', 'ready', false),
      await seedCleanupScenario('completed', 'error', false),
      await seedCleanupScenario('completed', 'processing', false),
    ];

    const claims = await repository.claimDue(randomUUID(), 10);
    expect(claims).toHaveLength(5);
    for (const scenario of scenarios) {
      expect(claims).toContainEqual(
        expect.objectContaining({
          session_id: scenario.sessionId,
          video_id: scenario.videoId,
          source_key: scenario.sourceKey,
        }),
      );
    }
    expect(claims.map((claim) => claim.session_state)).toEqual(
      expect.arrayContaining([
        'aborted',
        'expired',
        'completed',
        'completed',
        'completed',
      ]),
    );
    expect(claims.map((claim) => claim.video_status)).toEqual(
      expect.arrayContaining([
        'draft',
        'draft',
        'ready',
        'error',
        'processing',
      ]),
    );
  });

  it('prevents concurrent workers from claiming the same obligation', async () => {
    const { sessionId } = await seedCleanupScenario('aborted', 'draft', false);
    const [left, right] = await Promise.all([
      repository.claimDue(randomUUID(), 1),
      repository.claimDue(randomUUID(), 1),
    ]);

    expect([...left, ...right].map((claim) => claim.session_id)).toEqual([
      sessionId,
    ]);
  });

  it('claims ordered pages without starving later work or reserving released quota', async () => {
    const sessionIds = await seedTerminalSessions();
    const first = await repository.claimDue(randomUUID(), 2);
    const second = await repository.claimDue(randomUUID(), 2);

    expect(first.map(({ session_id }) => session_id)).toEqual(
      expect.arrayContaining(sessionIds.slice(0, 2)),
    );
    expect(second.map(({ session_id }) => session_id)).toEqual(
      sessionIds.slice(2),
    );

    const rows = await source.query<{ quota_released_at: Date | null }[]>(
      `SELECT quota_released_at FROM video_upload_sessions
       WHERE id=ANY($1::uuid[]) ORDER BY created_at`,
      [sessionIds],
    );
    expect(
      rows.every(({ quota_released_at }) => quota_released_at instanceof Date),
    ).toBe(true);
  });

  it('rechecks verified obligations later and reschedules failures with a bounded backoff', async () => {
    const [sessionId] = await seedTerminalSessions();
    const [before] = await source.query<{ quota_released_at: Date }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    const token = randomUUID();
    expect(await repository.claimDue(token, 1)).toHaveLength(1);
    expect(await repository.confirmAndReleaseQuota(sessionId, token)).toBe(
      true,
    );
    const [after] = await source.query<{ quota_released_at: Date }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    expect(after.quota_released_at).toEqual(before.quota_released_at);
    expect(await repository.claimDue(randomUUID(), 10)).toHaveLength(2);

    await source.query(
      `UPDATE video_cleanup_obligations SET next_attempt_at=now()-interval '1 second'
       WHERE session_id=$1`,
      [sessionId],
    );
    const retryToken = randomUUID();
    expect(await repository.claimDue(retryToken, 10)).toEqual([
      expect.objectContaining({ session_id: sessionId, state: 'verified' }),
    ]);
    expect(await repository.reschedule(sessionId, retryToken)).toBe(true);
  });

  it('releases quota only after a valid cleanup confirmation', async () => {
    const { sessionId } = await seedCleanupScenario('aborted', 'draft', false);
    const token = randomUUID();
    expect(await repository.claimDue(token, 1)).toHaveLength(1);

    expect(
      await repository.confirmAndReleaseQuota(sessionId, randomUUID()),
    ).toBe(false);
    let [session] = await source.query<{ quota_released_at: Date | null }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    expect(session.quota_released_at).toBeNull();

    expect(await repository.confirmAndReleaseQuota(sessionId, token)).toBe(
      true,
    );
    [session] = await source.query<{ quota_released_at: Date | null }[]>(
      'SELECT quota_released_at FROM video_upload_sessions WHERE id=$1',
      [sessionId],
    );
    expect(session.quota_released_at).toBeInstanceOf(Date);
  });

  it('uses the existing eligibility index for the final claim predicate', async () => {
    await source.query('SET enable_seqscan=off');
    try {
      const plan = await source.query<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (COSTS OFF)
         SELECT obligation.session_id
         FROM video_cleanup_obligations obligation
         WHERE obligation.next_attempt_at<=now()
           AND (obligation.locked_until IS NULL OR obligation.locked_until<=now())
         ORDER BY obligation.next_attempt_at,obligation.session_id
         LIMIT 20`,
      );
      expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'IDX_cleanup_eligible',
      );
    } finally {
      await source.query('RESET enable_seqscan');
    }
  });
});
