import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideoCleanupObligations1794000001000 implements MigrationInterface {
  name = 'CreateVideoCleanupObligations1794000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "video_cleanup_obligations" (
        "session_id" uuid NOT NULL,
        "state" varchar(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "lock_token" uuid,
        "locked_until" timestamptz,
        "confirmed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_video_cleanup_obligations" PRIMARY KEY ("session_id"),
        CONSTRAINT "CHK_cleanup_state" CHECK ("state" IN ('pending','verified')),
        CONSTRAINT "CHK_cleanup_attempts" CHECK ("attempts" >= 0),
        CONSTRAINT "FK_cleanup_session" FOREIGN KEY ("session_id")
          REFERENCES "video_upload_sessions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cleanup_eligible"
      ON "video_cleanup_obligations"
      ("next_attempt_at", "locked_until", "session_id")
    `);
    await queryRunner.query(`
      INSERT INTO "video_cleanup_obligations" ("session_id", "next_attempt_at")
      SELECT "id", now()
      FROM "video_upload_sessions"
      WHERE "state" IN ('completed','aborted','expired')
      ON CONFLICT ("session_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "video_cleanup_obligations"`);
  }
}
