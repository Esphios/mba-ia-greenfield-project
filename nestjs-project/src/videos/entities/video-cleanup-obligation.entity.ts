import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { VideoUploadSession } from './video-upload-session.entity';

@Entity('video_cleanup_obligations')
export class VideoCleanupObligation {
  @PrimaryColumn('uuid')
  session_id: string;

  @Column({ type: 'varchar', length: 16 })
  state: 'pending' | 'verified';

  @Column({ type: 'integer' })
  attempts: number;

  @Column({ type: 'timestamptz' })
  next_attempt_at: Date;

  @Column({ type: 'uuid', nullable: true })
  lock_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  locked_until: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmed_at: Date | null;

  @Column({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz' })
  updated_at: Date;

  @OneToOne(() => VideoUploadSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: VideoUploadSession;
}
