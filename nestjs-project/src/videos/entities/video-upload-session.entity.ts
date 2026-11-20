import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type VideoUploadState =
  | 'initiating'
  | 'uploading'
  | 'completing'
  | 'completed'
  | 'aborted'
  | 'expired';

@Entity('video_upload_sessions')
export class VideoUploadSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', unique: true }) video_id: string;
  @Column({ type: 'uuid' }) channel_id: string;
  @Column({ type: 'uuid' }) idempotency_key: string;
  @Column({ type: 'varchar', length: 64 }) request_hash: string;
  @Column({ type: 'text', nullable: true }) storage_upload_id: string | null;
  @Column({ type: 'varchar', length: 16 }) state: VideoUploadState;
  @Column({ type: 'integer' }) expected_parts: number;
  @Column({ type: 'timestamptz' }) expires_at: Date;
  @Column({ type: 'timestamptz', nullable: true })
  completion_started_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true })
  quota_released_at: Date | null;
  @Column({ type: 'uuid', nullable: true }) operation_token: string | null;
  @Column({ type: 'timestamptz', nullable: true }) operation_until: Date | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) last_error_code:
    | string
    | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
