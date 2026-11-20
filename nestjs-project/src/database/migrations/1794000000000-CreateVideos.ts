import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1794000000000 implements MigrationInterface {
  name = 'CreateVideos1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "public_id" varchar(22) NOT NULL,
        "channel_id" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "original_filename" varchar(255) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "size_bytes" bigint NOT NULL,
        "source_key" text NOT NULL,
        "stream_key" text,
        "thumbnail_key" text,
        "duration_ms" bigint,
        "metadata" jsonb,
        "failure_code" varchar(64),
        "processing_attempts" integer NOT NULL DEFAULT 0,
        "attempt_id" uuid,
        "lease_until" timestamptz,
        "processing_next_attempt_at" timestamptz,
        "processing_started_at" timestamptz,
        "processed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_videos" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_videos_public_id" UNIQUE ("public_id"),
        CONSTRAINT "UQ_videos_source_key" UNIQUE ("source_key"),
        CONSTRAINT "UQ_videos_id_channel" UNIQUE ("id", "channel_id"),
        CONSTRAINT "CHK_videos_status" CHECK ("status" IN ('draft','processing','ready','error')),
        CONSTRAINT "CHK_videos_size" CHECK ("size_bytes" BETWEEN 1 AND 10000000000),
        CONSTRAINT "CHK_videos_duration" CHECK ("duration_ms" IS NULL OR "duration_ms" > 0),
        CONSTRAINT "CHK_videos_attempts" CHECK ("processing_attempts" BETWEEN 0 AND 3),
        CONSTRAINT "CHK_videos_ready" CHECK ("status" <> 'ready' OR ("stream_key" IS NOT NULL AND "thumbnail_key" IS NOT NULL AND "duration_ms" IS NOT NULL AND "metadata" IS NOT NULL)),
        CONSTRAINT "CHK_videos_error" CHECK ("status" <> 'error' OR "failure_code" IS NOT NULL),
        CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_processing_lease" ON "videos" ("lease_until") WHERE "status" = 'processing'`,
    );

    await queryRunner.query(`
      CREATE TABLE "video_upload_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "video_id" uuid NOT NULL,
        "channel_id" uuid NOT NULL,
        "idempotency_key" uuid NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "storage_upload_id" text,
        "state" varchar(16) NOT NULL,
        "expected_parts" integer NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "completion_started_at" timestamptz,
        "quota_released_at" timestamptz,
        "operation_token" uuid,
        "operation_until" timestamptz,
        "last_error_code" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_video_upload_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_upload_video" UNIQUE ("video_id"),
        CONSTRAINT "UQ_upload_channel_idempotency" UNIQUE ("channel_id", "idempotency_key"),
        CONSTRAINT "CHK_upload_state" CHECK ("state" IN ('initiating','uploading','completing','completed','aborted','expired')),
        CONSTRAINT "CHK_upload_expected_parts" CHECK ("expected_parts" BETWEEN 1 AND 150),
        CONSTRAINT "FK_upload_video_channel" FOREIGN KEY ("video_id", "channel_id") REFERENCES "videos"("id", "channel_id") ON DELETE CASCADE,
        CONSTRAINT "FK_upload_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_upload_channel_state" ON "video_upload_sessions" ("channel_id", "state")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_upload_state_expires" ON "video_upload_sessions" ("state", "expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_upload_active_quota" ON "video_upload_sessions" ("channel_id") WHERE "quota_released_at" IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "video_processing_outbox" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "video_id" uuid NOT NULL,
        "processing_version" integer NOT NULL DEFAULT 1,
        "event_type" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "publish_attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL,
        "lock_token" uuid,
        "locked_until" timestamptz,
        "published_at" timestamptz,
        "finalized_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_video_processing_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_outbox_video_version" UNIQUE ("video_id", "processing_version"),
        CONSTRAINT "CHK_outbox_attempts" CHECK ("publish_attempts" >= 0),
        CONSTRAINT "FK_outbox_video" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_dispatch" ON "video_processing_outbox" ("next_attempt_at", "locked_until") WHERE "finalized_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "video_processing_outbox"`);
    await queryRunner.query(`DROP TABLE "video_upload_sessions"`);
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
