import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface PendingVideoRow {
  id: string;
  processing_attempts: number;
}

export interface ProcessingAttemptRow {
  status: string;
  attempt_id: string | null;
  lease_active: boolean;
}

@Injectable()
export class ProcessingRecoveryRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  findRecoverableVideos(): Promise<PendingVideoRow[]> {
    return this.dataSource.query(
      `SELECT id,processing_attempts FROM videos
       WHERE status='processing'
         AND (lease_until IS NULL OR lease_until<=now())
         AND (processing_next_attempt_at IS NULL OR processing_next_attempt_at<=now())
       ORDER BY updated_at LIMIT 100`,
    );
  }

  async finalizeExhausted(videoId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<{ id: string }[]>(
        `UPDATE videos SET status='error',failure_code='PROCESSING_FAILED',
           lease_until=NULL,updated_at=now()
         WHERE id=$1 AND status='processing' AND processing_attempts>=3
           AND (lease_until IS NULL OR lease_until<=now()) RETURNING id`,
        [videoId],
      );
      if (rows.length) {
        await manager.query(
          'UPDATE video_processing_outbox SET finalized_at=now() WHERE video_id=$1',
          [videoId],
        );
        await manager.query(
          `INSERT INTO video_cleanup_obligations(session_id,state,next_attempt_at)
           SELECT id,'pending',now() FROM video_upload_sessions
           WHERE video_id=$1 AND state='completed'
           ON CONFLICT(session_id) DO UPDATE SET state='pending',confirmed_at=NULL,
             next_attempt_at=now(),lock_token=NULL,locked_until=NULL,updated_at=now()`,
          [videoId],
        );
      }
      return rows.length === 1;
    });
  }

  async requeueOutbox(videoId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `UPDATE video_processing_outbox o
       SET next_attempt_at=now(),published_at=NULL,lock_token=NULL,locked_until=NULL
       FROM videos v
       WHERE o.video_id=v.id AND v.id=$1 AND o.finalized_at IS NULL
         AND v.status='processing' AND v.processing_attempts<3
         AND (v.lease_until IS NULL OR v.lease_until<=now())
         AND (v.processing_next_attempt_at IS NULL OR v.processing_next_attempt_at<=now())
       RETURNING o.id`,
      [videoId],
    );
    return rows.length > 0;
  }

  findAbandonedVideos(): Promise<{ id: string }[]> {
    return this.dataSource.query(
      `SELECT id FROM videos WHERE status='processing'
         AND updated_at<now()-interval '24 hours'
         AND (lease_until IS NULL OR lease_until<=now())
       ORDER BY updated_at LIMIT 20`,
    );
  }

  async findProcessingAttempt(
    videoId: string,
  ): Promise<ProcessingAttemptRow | null> {
    const rows = await this.dataSource.query<ProcessingAttemptRow[]>(
      `SELECT status,attempt_id,lease_until>now() AS lease_active
       FROM videos WHERE id=$1`,
      [videoId],
    );
    return rows[0] ?? null;
  }

  private rows<T = { id: string }>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    return (Array.isArray(result[0]) ? result[0] : result) as T[];
  }
}
