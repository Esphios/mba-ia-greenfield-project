import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Video } from './entities/video.entity';

export interface OwnedVideoRow {
  id: string;
  public_id: string;
  title: string;
  original_filename: string;
  size_bytes: string;
  status: string;
  source_key: string;
  stream_key: string | null;
  thumbnail_key: string | null;
  duration_ms: string | null;
  metadata: unknown;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProcessingStateRow {
  status: string;
  attempt_id: string | null;
  stream_key: string | null;
  thumbnail_key: string | null;
}

@Injectable()
export class VideosRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findOwnedVideo(
    userId: string,
    publicId: string,
  ): Promise<OwnedVideoRow | null> {
    const rows = await this.dataSource.query<OwnedVideoRow[]>(
      `SELECT v.id,v.public_id,v.title,v.original_filename,v.size_bytes,v.status,
              v.source_key,v.stream_key,v.thumbnail_key,
              v.duration_ms,v.metadata,v.failure_code,v.created_at,v.updated_at
       FROM videos v JOIN channels c ON c.id=v.channel_id
       WHERE v.public_id=$1 AND c.user_id=$2`,
      [publicId, userId],
    );
    return rows[0] ?? null;
  }

  async claimProcessing(videoId: string): Promise<Video | null> {
    const result: unknown = await this.dataSource.query(
      `UPDATE videos
       SET attempt_id = uuid_generate_v4(),
           lease_until = now() + interval '120 seconds',
           processing_started_at = COALESCE(processing_started_at, now()),
           processing_attempts = processing_attempts + 1,
           updated_at = now()
       WHERE id = $1
         AND status = 'processing'
         AND processing_attempts < 3
         AND (lease_until IS NULL OR lease_until <= now())
         AND (processing_next_attempt_at IS NULL OR processing_next_attempt_at <= now())
       RETURNING *`,
      [videoId],
    );
    const rows = this.normalizeRows<Video>(result);
    return rows[0] ?? null;
  }

  async heartbeat(videoId: string, attemptId: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE videos
       SET lease_until = now() + interval '120 seconds', updated_at = now()
       WHERE id = $1 AND attempt_id = $2 AND status = 'processing'
         AND lease_until > now()
       RETURNING id`,
      [videoId, attemptId],
    );
    const rows = this.normalizeRows<{ id: string }>(result);
    return rows.length === 1;
  }

  async findProcessingState(
    videoId: string,
  ): Promise<ProcessingStateRow | null> {
    const rows = await this.dataSource.query<ProcessingStateRow[]>(
      `SELECT status,attempt_id,stream_key,thumbnail_key
       FROM videos WHERE id=$1`,
      [videoId],
    );
    return rows[0] ?? null;
  }

  async markReady(
    videoId: string,
    attemptId: string,
    durationMs: number,
    metadata: unknown,
    streamKey: string,
    thumbnailKey: string,
    deadline: Date,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const result: unknown = await manager.query(
        `UPDATE videos SET status='ready',duration_ms=$3,metadata=$4,
           stream_key=$5,thumbnail_key=$6,processed_at=now(),lease_until=NULL,
           updated_at=now()
         WHERE id=$1 AND attempt_id=$2 AND status='processing' AND lease_until>now()
           AND clock_timestamp()<$7
         RETURNING id`,
        [
          videoId,
          attemptId,
          durationMs,
          JSON.stringify(metadata),
          streamKey,
          thumbnailKey,
          deadline,
        ],
      );
      const rows = this.normalizeRows<{ id: string }>(result);
      if (rows.length) {
        await manager.query(
          'UPDATE video_processing_outbox SET finalized_at=now() WHERE video_id=$1',
          [videoId],
        );
      }
      return rows.length === 1;
    });
  }

  async recordProcessingFailure(
    videoId: string,
    attemptId: string,
    permanent: boolean,
    code: string,
  ): Promise<string | null> {
    return this.dataSource.transaction(async (manager) => {
      const result: unknown = await manager.query(
        `UPDATE videos SET status=CASE WHEN $3 OR processing_attempts>=3 THEN 'error' ELSE 'processing' END,
           failure_code=CASE WHEN $3 OR processing_attempts>=3 THEN $4 ELSE NULL END,
           lease_until=NULL,
           processing_next_attempt_at=CASE WHEN $3 OR processing_attempts>=3 THEN NULL
             ELSE now() + interval '5 seconds' * power(2,processing_attempts-1) END,
           updated_at=now()
         WHERE id=$1 AND attempt_id=$2 AND status='processing' AND lease_until>now()
         RETURNING status`,
        [videoId, attemptId, permanent, code],
      );
      const rows = this.normalizeRows<{ status: string }>(result);
      if (rows[0]?.status === 'error') {
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
      return rows[0]?.status ?? null;
    });
  }

  private normalizeRows<T>(result: unknown): T[] {
    if (!Array.isArray(result)) {
      return [];
    }
    if (Array.isArray(result[0])) {
      return result[0] as T[];
    }
    return result as T[];
  }
}
