import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface VideoProcessingRequestedPayload {
  eventId: string;
  videoId: string;
  processingVersion: 1;
  occurredAt: string;
}

@Entity('video_processing_outbox')
export class VideoProcessingOutbox {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) video_id: string;
  @Column({ type: 'integer', default: 1 }) processing_version: number;
  @Column({ type: 'varchar', length: 64 }) event_type: string;
  @Column({ type: 'jsonb' }) payload: VideoProcessingRequestedPayload;
  @Column({ type: 'integer', default: 0 }) publish_attempts: number;
  @Column({ type: 'timestamptz' }) next_attempt_at: Date;
  @Column({ type: 'uuid', nullable: true }) lock_token: string | null;
  @Column({ type: 'timestamptz', nullable: true }) locked_until: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) published_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) finalized_at: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}
