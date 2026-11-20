import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VideoUploadState } from './entities/video-upload-session.entity';
import { VideoStatus } from './entities/video.entity';

export interface CleanupObligationClaim {
  session_id: string;
  state: 'pending' | 'verified';
  attempts: number;
  lock_token: string;
  session_state: VideoUploadState;
  video_id: string;
  channel_id: string;
  storage_upload_id: string | null;
  video_status: VideoStatus;
  source_key: string;
  stream_key: string | null;
  thumbnail_key: string | null;
}

@Injectable()
export class CleanupObligationRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async claimDue(
    token: string,
    limit: number,
  ): Promise<CleanupObligationClaim[]> {
    const result: unknown = await this.dataSource.query(
      `WITH due AS (
         SELECT obligation.session_id,session.state session_state,
                session.video_id,session.channel_id,session.storage_upload_id,
                video.status video_status,video.source_key,video.stream_key,
                video.thumbnail_key
         FROM video_cleanup_obligations obligation
         JOIN video_upload_sessions session ON session.id=obligation.session_id
         JOIN videos video ON video.id=session.video_id
         WHERE obligation.next_attempt_at<=now()
           AND (obligation.locked_until IS NULL OR obligation.locked_until<=now())
         ORDER BY obligation.next_attempt_at,obligation.session_id
         FOR UPDATE OF obligation SKIP LOCKED
         LIMIT $2
       )
       UPDATE video_cleanup_obligations obligation
       SET lock_token=$1,locked_until=now()+interval '2 minutes',updated_at=now()
       FROM due
       WHERE obligation.session_id=due.session_id
       RETURNING obligation.session_id,obligation.state,obligation.attempts,
                 obligation.lock_token,due.session_state,due.video_id,
                 due.channel_id,due.storage_upload_id,due.video_status,
                 due.source_key,due.stream_key,due.thumbnail_key`,
      [token, Math.max(1, Math.min(limit, 100))],
    );
    return this.rows<CleanupObligationClaim>(result).sort((left, right) =>
      left.session_id.localeCompare(right.session_id),
    );
  }

  async confirmAndReleaseQuota(
    sessionId: string,
    token: string,
    expected?: CleanupObligationClaim,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const result: unknown = await manager.query(
        `UPDATE video_cleanup_obligations
         SET state='verified',confirmed_at=now(),attempts=0,
             next_attempt_at=now()+interval '1 hour',lock_token=NULL,
             locked_until=NULL,updated_at=now()
         WHERE session_id=$1 AND lock_token=$2 AND locked_until>now()
           AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM video_upload_sessions session
             JOIN videos video ON video.id=session.video_id
             WHERE session.id=video_cleanup_obligations.session_id
               AND session.video_id=$3
               AND session.state=$4
               AND video.status=$5
               AND video.source_key=$6
               AND video.stream_key IS NOT DISTINCT FROM $7
               AND video.thumbnail_key IS NOT DISTINCT FROM $8))
         RETURNING session_id`,
        [
          sessionId,
          token,
          expected?.video_id ?? null,
          expected?.session_state ?? null,
          expected?.video_status ?? null,
          expected?.source_key ?? null,
          expected?.stream_key ?? null,
          expected?.thumbnail_key ?? null,
        ],
      );
      if (this.rows(result).length !== 1) return false;
      await manager.query(
        `UPDATE video_upload_sessions
         SET quota_released_at=COALESCE(quota_released_at,now()),
             storage_upload_id=NULL,updated_at=now()
         WHERE id=$1`,
        [sessionId],
      );
      return true;
    });
  }

  async reschedule(sessionId: string, token: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE video_cleanup_obligations
       SET state='pending',attempts=LEAST(attempts::bigint+1,2147483647)::integer,
           next_attempt_at=now()+interval '1 second' *
             LEAST(300,5*power(2,LEAST(attempts,6))),
           lock_token=NULL,locked_until=NULL,updated_at=now()
       WHERE session_id=$1 AND lock_token=$2
       RETURNING session_id`,
      [sessionId, token],
    );
    return this.rows(result).length === 1;
  }

  private rows<T = { session_id: string }>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    return (Array.isArray(result[0]) ? result[0] : result) as T[];
  }
}
