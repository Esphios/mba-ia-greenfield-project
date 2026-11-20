import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface ClaimedOutboxRow {
  id: string;
  video_id: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  claimBatch(token: string): Promise<ClaimedOutboxRow[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<ClaimedOutboxRow[]>(
        `SELECT id,video_id,payload FROM video_processing_outbox
         WHERE finalized_at IS NULL AND published_at IS NULL AND next_attempt_at<=now()
           AND (locked_until IS NULL OR locked_until<=now())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20`,
      );
      if (rows.length === 0) return rows;
      await manager.query(
        `UPDATE video_processing_outbox
         SET lock_token=$1,locked_until=now()+interval '30 seconds'
         WHERE id=ANY($2::uuid[])`,
        [token, rows.map((row) => row.id)],
      );
      return rows;
    });
  }

  async markPublished(id: string, token: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE video_processing_outbox
       SET published_at=COALESCE(published_at,now()),lock_token=NULL,locked_until=NULL
       WHERE id=$1 AND lock_token=$2`,
      [id, token],
    );
  }

  async markPublishFailed(id: string, token: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE video_processing_outbox
       SET publish_attempts=LEAST(publish_attempts::bigint+1,2147483647)::integer,
           next_attempt_at=now()+interval '1 second' *
             LEAST(300,5*power(2,LEAST(publish_attempts,6))),
           lock_token=NULL,locked_until=NULL
       WHERE id=$1 AND lock_token=$2`,
      [id, token],
    );
  }
}
