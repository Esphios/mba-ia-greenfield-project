-- Restore only the two verified test records after the isolated tmpfs DB is reset.
-- The source and derived objects remain in the dedicated MinIO volume.
WITH actor AS (
  INSERT INTO users (id, email, password, is_confirmed)
  VALUES (uuid_generate_v4(), 'restored-large@phase03.test', 'test-only', true)
  RETURNING id
), channel AS (
  INSERT INTO channels (id, name, nickname, user_id)
  SELECT uuid_generate_v4(), 'Restored large evidence', 'restored-large-phase03', id FROM actor
  RETURNING id
)
INSERT INTO videos (
  id, public_id, channel_id, title, original_filename, status, size_bytes,
  source_key, stream_key, thumbnail_key, duration_ms, metadata,
  processing_attempts, processed_at
)
SELECT
  '5ad4457a-85cc-49f5-9cfd-d500fa202ec7'::uuid,
  'Eo1GTdljeGhxKkQIWUXKoQ', channel.id, 'Boundary evidence',
  'boundary.mp4', 'ready', 10000000000,
  'videos/5ad4457a-85cc-49f5-9cfd-d500fa202ec7/source.mp4',
  'videos/5ad4457a-85cc-49f5-9cfd-d500fa202ec7/attempts/97f53715-29ec-4deb-9f2a-5ae5322bd16b/stream.mp4',
  'videos/5ad4457a-85cc-49f5-9cfd-d500fa202ec7/attempts/97f53715-29ec-4deb-9f2a-5ae5322bd16b/thumbnail.jpg',
  10000,
  '{"fps":{"numerator":25,"denominator":1},"width":3840,"format":"mp4","height":2160,"audioCodec":null,"videoCodec":"h264"}'::jsonb,
  1, now()
FROM channel
UNION ALL
SELECT
  'e2b2d71a-5979-4848-a77e-4b47fac4bff2'::uuid,
  '2Dx0XA1sANNFhNvVC6f_JA', channel.id, 'Representative evidence',
  'representative.mp4', 'ready', 9104679495,
  'videos/e2b2d71a-5979-4848-a77e-4b47fac4bff2/source.mp4',
  'videos/e2b2d71a-5979-4848-a77e-4b47fac4bff2/attempts/7f549044-e365-4d45-93ae-bccc2edf6227/stream.mp4',
  'videos/e2b2d71a-5979-4848-a77e-4b47fac4bff2/attempts/7f549044-e365-4d45-93ae-bccc2edf6227/thumbnail.jpg',
  680000,
  '{"fps":{"numerator":25,"denominator":1},"width":3840,"format":"mp4","height":2160,"audioCodec":null,"videoCodec":"h264"}'::jsonb,
  1, now()
FROM channel;
