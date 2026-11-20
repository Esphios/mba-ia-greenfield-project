import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export type VideoStatus = 'draft' | 'processing' | 'ready' | 'error';

export interface VideoMetadata {
  format: 'mp4';
  width: number;
  height: number;
  fps: {
    numerator: number;
    denominator: number;
  };
  videoCodec: 'h264';
  audioCodec: 'aac' | null;
}

const bigintNumberTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 22, unique: true }) public_id: string;
  @Column({ type: 'uuid' }) channel_id: string;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'varchar', length: 255 }) original_filename: string;
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: VideoStatus;
  @Column({ type: 'bigint', transformer: bigintNumberTransformer })
  size_bytes: number;
  @Column({ type: 'text', unique: true }) source_key: string;
  @Column({ type: 'text', nullable: true }) stream_key: string | null;
  @Column({ type: 'text', nullable: true }) thumbnail_key: string | null;
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: bigintNumberTransformer,
  })
  duration_ms: number | null;
  @Column({ type: 'jsonb', nullable: true }) metadata: VideoMetadata | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) failure_code:
    | string
    | null;
  @Column({ type: 'integer', default: 0 }) processing_attempts: number;
  @Column({ type: 'uuid', nullable: true }) attempt_id: string | null;
  @Column({ type: 'timestamptz', nullable: true }) lease_until: Date | null;
  @Column({ type: 'timestamptz', nullable: true })
  processing_next_attempt_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true })
  processing_started_at: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) processed_at: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;

  @ManyToOne(() => Channel, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
