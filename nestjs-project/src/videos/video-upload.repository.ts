import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { NormalizedVideoRequest } from './video-request-normalizer';
import { VIDEO_PART_BYTES } from '../common/video-limits';

export class UploadPersistenceError extends Error {
  constructor(
    readonly code:
      | 'IDEMPOTENCY_CONFLICT'
      | 'UPLOAD_QUOTA_EXCEEDED'
      | 'IDENTIFIER_ALLOCATION_FAILED',
  ) {
    super(code);
  }
}

export interface DraftReservation {
  video_id: string;
  public_id: string;
  session_id: string;
  state: string;
  expected_parts: number;
  expires_at: Date;
  last_error_code: string | null;
  request_hash: string;
  operation_until: Date | null;
  created: boolean;
  provisioning: boolean;
}

export interface OwnedUploadSessionRow {
  video_id: string;
  public_id: string;
  session_id: string;
  state: string;
  expected_parts: number;
  expires_at: Date;
  last_error_code: string | null;
  request_hash: string;
  operation_until: Date | null;
  source_key: string;
  size_bytes: string;
  storage_upload_id: string | null;
  video_status: string;
}

export type CompletionClaimResult =
  | { outcome: 'claimed' }
  | { outcome: 'completed'; videoStatus: string }
  | { outcome: 'expired' }
  | { outcome: 'conflict' };

export type CompletionFinalizationResult =
  | { outcome: 'finalized' }
  | { outcome: 'already-finalized'; videoStatus: string }
  | { outcome: 'conflict' };

@Injectable()
export class VideoUploadRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  reserveDraft(
    channelId: string,
    idempotencyKey: string,
    request: NormalizedVideoRequest,
    requestHash: string,
    operationToken: string,
    generatePublicId: () => string,
  ): Promise<DraftReservation> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [30_003]);
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        channelId,
      ]);
      await manager.query(
        `WITH terminal AS (
           UPDATE video_upload_sessions SET state='expired',operation_token=NULL,
             operation_until=NULL,last_error_code='UPLOAD_EXPIRED',updated_at=now()
           WHERE channel_id=$1 AND idempotency_key=$2
             AND state IN('initiating','uploading') AND expires_at<=now()
           RETURNING id)
         INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
         SELECT id,now() FROM terminal
         ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
           next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()`,
        [channelId, idempotencyKey],
      );
      const existing = await manager.query<
        Omit<DraftReservation, 'created' | 'provisioning'>[]
      >(
        `SELECT v.id video_id,v.public_id,s.id session_id,s.state,s.expected_parts,
                s.expires_at,s.last_error_code,s.request_hash,s.operation_until
         FROM video_upload_sessions s JOIN videos v ON v.id=s.video_id
         WHERE s.channel_id=$1 AND s.idempotency_key=$2`,
        [channelId, idempotencyKey],
      );
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash) {
          throw new UploadPersistenceError('IDEMPOTENCY_CONFLICT');
        }
        const claimResult: unknown = await manager.query(
          `UPDATE video_upload_sessions SET operation_token=$1,
             operation_until=now()+interval '120 seconds',updated_at=now()
           WHERE id=$2 AND state='initiating' AND expires_at>now()
             AND (operation_until IS NULL OR operation_until<=now())
           RETURNING operation_until`,
          [operationToken, existing[0].session_id],
        );
        const claimed = this.normalizeRows<{ operation_until: Date }>(
          claimResult,
        );
        return {
          ...existing[0],
          operation_until:
            claimed[0]?.operation_until ?? existing[0].operation_until,
          created: false,
          provisioning: claimed.length === 1,
        };
      }
      const [quota] = await manager.query<
        { global_count: string; channel_count: string }[]
      >(
        `SELECT count(*)::text global_count,
                count(*) FILTER (WHERE channel_id=$1)::text channel_count
         FROM video_upload_sessions WHERE quota_released_at IS NULL`,
        [channelId],
      );
      if (
        Number(quota.global_count) >= 10 ||
        Number(quota.channel_count) >= 2
      ) {
        throw new UploadPersistenceError('UPLOAD_QUOTA_EXCEEDED');
      }
      const videoId = randomUUID();
      let publicId: string | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const rows = await manager.query<{ public_id: string }[]>(
          `INSERT INTO videos
           (id,public_id,channel_id,title,original_filename,size_bytes,source_key)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(public_id) DO NOTHING RETURNING public_id`,
          [
            videoId,
            generatePublicId(),
            channelId,
            request.title,
            request.filename,
            request.sizeBytes,
            `videos/${videoId}/source.mp4`,
          ],
        );
        if (rows[0]) {
          publicId = rows[0].public_id;
          break;
        }
      }
      if (!publicId)
        throw new UploadPersistenceError('IDENTIFIER_ALLOCATION_FAILED');
      const sessionId = randomUUID();
      const expectedParts = Math.ceil(request.sizeBytes / VIDEO_PART_BYTES);
      const [session] = await manager.query<
        Omit<
          DraftReservation,
          'video_id' | 'public_id' | 'created' | 'provisioning'
        >[]
      >(
        `INSERT INTO video_upload_sessions
         (id,video_id,channel_id,idempotency_key,request_hash,state,expected_parts,
          expires_at,operation_token,operation_until)
         VALUES($1,$2,$3,$4,$5,'initiating',$6,now()+interval '24 hours',$7,
                now()+interval '120 seconds')
         RETURNING id session_id,state,expected_parts,expires_at,last_error_code,
                   request_hash,operation_until`,
        [
          sessionId,
          videoId,
          channelId,
          idempotencyKey,
          requestHash,
          expectedParts,
          operationToken,
        ],
      );
      return {
        ...session,
        video_id: videoId,
        public_id: publicId,
        created: true,
        provisioning: true,
      };
    });
  }

  observeOwnedSession(
    userId: string,
    publicId: string,
  ): Promise<OwnedUploadSessionRow | null> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `WITH terminal AS (
           UPDATE video_upload_sessions session
           SET state='expired',operation_token=NULL,operation_until=NULL,
             last_error_code='UPLOAD_EXPIRED',updated_at=now()
           FROM videos video,channels channel
           WHERE session.video_id=video.id AND video.channel_id=channel.id
             AND video.public_id=$1 AND channel.user_id=$2
             AND session.state IN('initiating','uploading')
             AND session.expires_at<=now()
           RETURNING session.id)
         INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
         SELECT id,now() FROM terminal
         ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
           next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()`,
        [publicId, userId],
      );
      const rows = await manager.query<OwnedUploadSessionRow[]>(
        `SELECT video.id video_id,video.public_id,video.source_key,
                video.size_bytes,video.status video_status,
                session.id session_id,session.state,session.expected_parts,
                session.expires_at,session.last_error_code,session.request_hash,
                session.operation_until,session.storage_upload_id
         FROM videos video JOIN channels channel ON channel.id=video.channel_id
         JOIN video_upload_sessions session ON session.video_id=video.id
         WHERE video.public_id=$1 AND channel.user_id=$2`,
        [publicId, userId],
      );
      return rows[0] ?? null;
    });
  }

  async adoptProvisionedMultipart(
    sessionId: string,
    token: string,
    uploadId: string,
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE video_upload_sessions
       SET storage_upload_id=$3,state='uploading',operation_token=NULL,
           operation_until=NULL,last_error_code=NULL,updated_at=now()
       WHERE id=$1 AND state='initiating' AND operation_token=$2
         AND operation_until>now() AND expires_at>now() RETURNING id`,
      [sessionId, token, uploadId],
    );
    return this.normalizeRows<{ id: string }>(result).length === 1;
  }

  async renewProvisioningLease(
    sessionId: string,
    token: string,
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE video_upload_sessions
       SET operation_until=now()+interval '120 seconds',updated_at=now()
       WHERE id=$1 AND state='initiating' AND operation_token=$2
         AND operation_until>now() AND expires_at>now()
       RETURNING id`,
      [sessionId, token],
    );
    return this.normalizeRows<{ id: string }>(result).length === 1;
  }

  async findProvisioningState(
    sessionId: string,
  ): Promise<{ state: string; storage_upload_id: string | null } | null> {
    const rows = await this.dataSource.query<
      { state: string; storage_upload_id: string | null }[]
    >(`SELECT state,storage_upload_id FROM video_upload_sessions WHERE id=$1`, [
      sessionId,
    ]);
    return rows[0] ?? null;
  }

  async isPersistedProvisioningWinner(
    sessionId: string,
    uploadId: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM video_upload_sessions
       WHERE id=$1 AND state='uploading' AND storage_upload_id=$2`,
      [sessionId, uploadId],
    );
    return rows.length === 1;
  }

  async markProvisioningUnavailable(
    sessionId: string,
    token: string,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE video_upload_sessions SET last_error_code='STORAGE_UNAVAILABLE',
         operation_token=NULL,operation_until=NULL,updated_at=now()
       WHERE id=$1 AND state='initiating' AND operation_token=$2`,
      [sessionId, token],
    );
  }

  async getSigningClock(
    sessionId: string,
  ): Promise<{ remaining_seconds: number; db_now: Date }> {
    const [row] = await this.dataSource.query<
      { remaining_seconds: number; db_now: Date }[]
    >(
      `WITH db_clock AS (SELECT clock_timestamp() AS current_time)
       SELECT floor(extract(epoch FROM (s.expires_at-db_clock.current_time)))::integer remaining_seconds,
              db_clock.current_time db_now
       FROM video_upload_sessions s CROSS JOIN db_clock WHERE s.id=$1`,
      [sessionId],
    );
    return row;
  }

  async expireUploading(sessionId: string): Promise<void> {
    await this.dataSource.query(
      `WITH terminal AS (
         UPDATE video_upload_sessions SET state='expired',updated_at=now()
         WHERE id=$1 AND state='uploading' AND expires_at<=now() RETURNING id)
       INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       SELECT id,now() FROM terminal
       ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
         next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()`,
      [sessionId],
    );
  }

  async claimCompletion(
    sessionId: string,
    token: string,
  ): Promise<CompletionClaimResult> {
    const result: unknown = await this.dataSource.query(
      `UPDATE video_upload_sessions SET state='completing',completion_started_at=now(),
         operation_token=$1,operation_until=now()+interval '120 seconds',updated_at=now()
       WHERE id=$2 AND state='uploading' AND now()<expires_at RETURNING id`,
      [token, sessionId],
    );
    if (this.normalizeRows<{ id: string }>(result).length === 1)
      return { outcome: 'claimed' };
    const rows = await this.dataSource.query<
      { state: string; video_status: string }[]
    >(
      `SELECT session.state,video.status video_status
       FROM video_upload_sessions session
       JOIN videos video ON video.id=session.video_id
       WHERE session.id=$1`,
      [sessionId],
    );
    if (rows[0]?.state === 'completed')
      return { outcome: 'completed', videoStatus: rows[0].video_status };
    if (rows[0]?.state === 'expired') return { outcome: 'expired' };
    return { outcome: 'conflict' };
  }

  async resetIncompleteCompletion(
    sessionId: string,
    token: string,
  ): Promise<'expired' | 'uploading'> {
    const result: unknown = await this.dataSource.query(
      `WITH terminal AS (
         UPDATE video_upload_sessions
         SET state=CASE WHEN expires_at<=now() THEN 'expired' ELSE 'uploading' END,
             completion_started_at=NULL,operation_token=NULL,operation_until=NULL,updated_at=now()
         WHERE id=$1 AND state='completing' AND operation_token=$2 RETURNING id,state
       ), scheduled AS (
         INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
         SELECT id,now() FROM terminal WHERE state='expired'
         ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
           next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()
         RETURNING session_id)
       SELECT state FROM terminal`,
      [sessionId, token],
    );
    return (
      this.normalizeRows<{ state: 'expired' | 'uploading' }>(result)[0]
        ?.state ?? 'expired'
    );
  }

  async abortSizeMismatch(sessionId: string, token: string): Promise<void> {
    await this.dataSource.query(
      `WITH terminal AS (
         UPDATE video_upload_sessions SET state='aborted',last_error_code='UPLOAD_SIZE_MISMATCH',
         operation_token=NULL,operation_until=NULL,updated_at=now()
         WHERE id=$1 AND state='completing' AND operation_token=$2 RETURNING id)
       INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
       SELECT id,now() FROM terminal
       ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
         next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()`,
      [sessionId, token],
    );
  }

  async finalizeCompletion(
    sessionId: string,
    videoId: string,
    token: string,
  ): Promise<CompletionFinalizationResult> {
    return this.dataSource.transaction(async (manager) => {
      const result: unknown = await manager.query(
        `UPDATE video_upload_sessions SET state='completed',operation_token=NULL,
         operation_until=NULL,updated_at=now()
         WHERE id=$1 AND state='completing' AND operation_token=$2 RETURNING id`,
        [sessionId, token],
      );
      if (!this.normalizeRows<{ id: string }>(result).length) {
        const rows = await manager.query<
          { state: string; video_status: string }[]
        >(
          `SELECT session.state,video.status video_status
           FROM video_upload_sessions session
           JOIN videos video ON video.id=session.video_id
           WHERE session.id=$1`,
          [sessionId],
        );
        if (rows[0]?.state === 'completed')
          return {
            outcome: 'already-finalized',
            videoStatus: rows[0].video_status,
          };
        return { outcome: 'conflict' };
      }
      await manager.query(
        `INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
         VALUES($1,now()) ON CONFLICT(session_id) DO UPDATE SET state='pending',
         confirmed_at=NULL,next_attempt_at=now(),lock_token=NULL,
         locked_until=NULL,updated_at=now()`,
        [sessionId],
      );
      await manager.query(
        `UPDATE videos SET status='processing',updated_at=now() WHERE id=$1`,
        [videoId],
      );
      const eventId = randomUUID();
      await manager.query(
        `INSERT INTO video_processing_outbox(id,video_id,event_type,payload,next_attempt_at)
         VALUES($1,$2,'video.processing.requested.v1',$3,now())
         ON CONFLICT(video_id,processing_version) DO NOTHING`,
        [
          eventId,
          videoId,
          JSON.stringify({
            eventId,
            videoId,
            processingVersion: 1,
            occurredAt: new Date().toISOString(),
          }),
        ],
      );
      return { outcome: 'finalized' };
    });
  }

  async abortSession(sessionId: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `WITH terminal AS (
         UPDATE video_upload_sessions SET state='aborted',operation_token=NULL,
         operation_until=NULL,updated_at=now()
         WHERE id=$1 AND state IN('initiating','uploading') RETURNING id),
       scheduled AS (
         INSERT INTO video_cleanup_obligations(session_id,next_attempt_at)
         SELECT id,now() FROM terminal
         ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
           next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()
         RETURNING session_id)
       SELECT id FROM terminal`,
      [sessionId],
    );
    return this.normalizeRows<{ id: string }>(result).length === 1;
  }

  private normalizeRows<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    return (Array.isArray(result[0]) ? result[0] : result) as T[];
  }
}
