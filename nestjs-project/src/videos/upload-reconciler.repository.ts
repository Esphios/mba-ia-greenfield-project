import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

export interface RecoverableSessionRow {
  id: string;
  video_id: string;
  source_key: string;
  size_bytes: string;
  storage_upload_id: string | null;
  expected_parts: number;
  operation_token: string;
}

@Injectable()
export class UploadReconcilerRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async claimInitiating(token: string): Promise<RecoverableSessionRow[]> {
    const result: unknown = await this.dataSource.query(
      `UPDATE video_upload_sessions s SET operation_token=$1,
         operation_until=now()+interval '2 minutes',updated_at=now()
       FROM videos v WHERE s.video_id=v.id AND s.state='initiating'
         AND s.expires_at>now()
         AND (s.operation_until IS NULL OR s.operation_until<=now())
       RETURNING s.id,s.video_id,s.storage_upload_id,s.expected_parts,
                 s.operation_token,v.source_key,v.size_bytes`,
      [token],
    );
    return this.rows(result);
  }

  async releaseInitiating(sessionId: string, token: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE video_upload_sessions SET operation_until=now(),updated_at=now()
       WHERE id=$1 AND state='initiating' AND operation_token=$2`,
      [sessionId, token],
    );
  }

  async expireSessions(): Promise<number> {
    const result: unknown = await this.dataSource.query(
      `WITH terminal AS (
         UPDATE video_upload_sessions SET state='expired',operation_token=NULL,
         operation_until=NULL,last_error_code='UPLOAD_EXPIRED',updated_at=now()
         WHERE state IN('initiating','uploading') AND expires_at<=now() RETURNING id)
       INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       SELECT id,now() FROM terminal
       ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
         next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()
       RETURNING session_id`,
    );
    return this.rows(result).length;
  }

  findCompletingCandidateIds(): Promise<{ id: string }[]> {
    return this.dataSource.query(
      `SELECT id FROM video_upload_sessions WHERE state='completing'
       AND (operation_until IS NULL OR operation_until<=now())`,
    );
  }

  async claimCompleting(
    id: string,
    token: string,
  ): Promise<RecoverableSessionRow | null> {
    const result: unknown = await this.dataSource.query(
      `WITH claimed AS (
         UPDATE video_upload_sessions SET operation_token=$2,
           operation_until=now()+interval '2 minutes',updated_at=now()
         WHERE id=$1 AND state='completing'
           AND (operation_until IS NULL OR operation_until<=now()) RETURNING *)
       SELECT s.id,s.video_id,s.storage_upload_id,s.expected_parts,s.operation_token,
              v.source_key,v.size_bytes FROM claimed s JOIN videos v ON v.id=s.video_id`,
      [id, token],
    );
    return this.rows<RecoverableSessionRow>(result)[0] ?? null;
  }

  async returnIncomplete(sessionId: string, token: string): Promise<void> {
    await this.dataSource.query(
      `WITH terminal AS (
         UPDATE video_upload_sessions SET
           state=CASE WHEN expires_at<=now() THEN 'expired' ELSE 'uploading' END,
           completion_started_at=NULL,operation_token=NULL,operation_until=NULL,
           last_error_code=CASE WHEN expires_at<=now() THEN 'UPLOAD_EXPIRED'
                                ELSE 'UPLOAD_INCOMPLETE' END,updated_at=now()
         WHERE id=$1 AND state='completing' AND operation_token=$2
           AND operation_until>now() RETURNING id,state)
       INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       SELECT id,now() FROM terminal WHERE state='expired'
       ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
         next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()`,
      [sessionId, token],
    );
  }

  async transitionCompleting(
    sessionId: string,
    token: string,
    errorCode: string,
  ): Promise<void> {
    await this.dataSource.query(
      `WITH terminal AS (
         UPDATE video_upload_sessions SET state='aborted',last_error_code=$3,
         operation_token=NULL,operation_until=NULL,updated_at=now()
         WHERE id=$1 AND state='completing' AND operation_token=$2
           AND operation_until>now() RETURNING id)
       INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       SELECT id,now() FROM terminal
       ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
         next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()`,
      [sessionId, token, errorCode],
    );
  }

  async renewCompletingLease(
    sessionId: string,
    token: string,
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE video_upload_sessions SET operation_until=now()+interval '2 minutes',
       updated_at=now() WHERE id=$1 AND state='completing' AND operation_token=$2
       AND operation_until>now() RETURNING id`,
      [sessionId, token],
    );
    return this.rows(result).length === 1;
  }

  async releaseCompleting(sessionId: string, token: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE video_upload_sessions SET operation_until=now(),updated_at=now()
       WHERE id=$1 AND state='completing' AND operation_token=$2`,
      [sessionId, token],
    );
  }

  async finalizeRecoveredCompletion(
    session: RecoverableSessionRow,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const result: unknown = await manager.query(
        `UPDATE video_upload_sessions SET state='completed',operation_token=NULL,
         operation_until=NULL,updated_at=now()
         WHERE id=$1 AND state='completing' AND operation_token=$2
           AND operation_until>now() RETURNING id`,
        [session.id, session.operation_token],
      );
      if (!this.rows(result).length) return false;
      await manager.query(
        `INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
         VALUES($1,now()) ON CONFLICT(session_id) DO UPDATE SET state='pending',
         confirmed_at=NULL,next_attempt_at=now(),lock_token=NULL,
         locked_until=NULL,updated_at=now()`,
        [session.id],
      );
      await manager.query(
        `UPDATE videos SET status='processing',updated_at=now() WHERE id=$1`,
        [session.video_id],
      );
      const eventId = randomUUID();
      await manager.query(
        `INSERT INTO video_processing_outbox(id,video_id,event_type,payload,next_attempt_at)
         VALUES($1,$2,'video.processing.requested.v1',$3,now())
         ON CONFLICT(video_id,processing_version) DO NOTHING`,
        [
          eventId,
          session.video_id,
          JSON.stringify({
            eventId,
            videoId: session.video_id,
            processingVersion: 1,
            occurredAt: new Date().toISOString(),
          }),
        ],
      );
      return true;
    });
  }

  private rows<T = { id: string }>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    return (Array.isArray(result[0]) ? result[0] : result) as T[];
  }
}
