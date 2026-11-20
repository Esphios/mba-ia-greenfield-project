const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Client } = require('pg');
const { Queue } = require('bullmq');
const { readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');

async function main() {
  const expectedStatus = process.env.SMOKE_EXPECT_STATUS ?? 'ready';
  const expectedFailureCode = process.env.SMOKE_EXPECT_FAILURE_CODE;
  if (process.env.NODE_ENV !== 'test' || process.env.DB_NAME !== 'streamtube_phase03_test') {
    throw new Error('Smoke test requires the disposable phase 03 database');
  }
  const id = randomUUID();
  const userId = randomUUID();
  const channelId = randomUUID();
  const sourceKey = `videos/${id}/source.mp4`;
  const file = readFileSync(process.env.SMOKE_SOURCE_PATH ?? '/tmp/phase03-smoke.mp4');
  const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_INTERNAL_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  const db = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const queue = new Queue('video-processing', {
    prefix: process.env.VIDEO_QUEUE_PREFIX,
    connection: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT) },
  });
  try {
    await db.connect();
    const target = await db.query('SELECT current_database()');
    if (target.rows[0].current_database !== process.env.DB_NAME) throw new Error('Database target changed');
    if (process.env.SMOKE_SKIP_UPLOAD !== '1') {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: sourceKey,
        Body: file,
        ContentType: 'video/mp4',
      }));
    }
    await db.query('INSERT INTO users(id,email,password) VALUES($1,$2,$3)', [userId, `${userId}@test.local`, 'hash']);
    await db.query('INSERT INTO channels(id,name,nickname,user_id) VALUES($1,$2,$3,$4)', [channelId, 'Worker smoke', `worker-${channelId}`, userId]);
    await db.query(
      `INSERT INTO videos(id,public_id,channel_id,title,original_filename,status,size_bytes,source_key)
       VALUES($1,$2,$3,$4,$5,'processing',$6,$7)`,
      [id, randomBytes(16).toString('base64url'), channelId, 'Smoke', 'smoke.mp4', file.length, sourceKey],
    );
    if (process.env.SMOKE_LOST_COMMIT === '1' || process.env.SMOKE_STALE_CAS === '1' || process.env.SMOKE_DB_UNAVAILABLE === '1' || process.env.SMOKE_DIRECT_ATTEMPTS) {
      const { NestFactory } = require('@nestjs/core');
      const { DataSource } = require('typeorm');
      const { VideoWorkerModule } = require('../../dist/video-worker.module');
      const { VideoProcessorService } = require('../../dist/videos/processing/video-processor.service');
      const app = await NestFactory.createApplicationContext(VideoWorkerModule, { logger: false });
      try {
        const source = app.get(DataSource);
        const transaction = source.transaction.bind(source);
        if (process.env.SMOKE_DB_UNAVAILABLE === '1') {
          source.transaction = async () => {
            source.query = async () => { throw new Error('Simulated database outage'); };
            throw new Error('Simulated database outage');
          };
          try { await app.get(VideoProcessorService).process(id); } catch {}
        } else if (process.env.SMOKE_STALE_CAS === '1') {
          source.transaction = async (...args) => {
            await source.query(
              "UPDATE videos SET attempt_id=$2,lease_until=now()+interval '2 minutes' WHERE id=$1",
              [id, randomUUID()],
            );
            return transaction(...args);
          };
          try { await app.get(VideoProcessorService).process(id); } catch {}
        } else if (process.env.SMOKE_LOST_COMMIT === '1') {
          source.transaction = async (...args) => {
            await transaction(...args);
            throw new Error('Simulated lost commit response');
          };
          try {
            await app.get(VideoProcessorService).process(id);
          } catch (processingError) {
            if (expectedStatus !== 'error') throw processingError;
          }
        } else {
          const count = Number(process.env.SMOKE_DIRECT_ATTEMPTS);
          for (let attempt = 0; attempt < count; attempt++) {
            try { await app.get(VideoProcessorService).process(id); } catch {}
            const result = (await db.query('SELECT status,processing_attempts,processing_next_attempt_at FROM videos WHERE id=$1', [id])).rows[0];
            if (result.processing_attempts !== attempt + 1) throw new Error(`Wrong DB budget: ${JSON.stringify(result)}`);
            if (attempt < count - 1 && (!result.processing_next_attempt_at || result.status !== 'processing')) {
              throw new Error(`Missing transient backoff: ${JSON.stringify(result)}`);
            }
            await db.query("UPDATE videos SET processing_next_attempt_at=now()-interval '1 second' WHERE id=$1", [id]);
          }
        }
      } finally {
        await app.close();
      }
    } else {
      const eventId = randomUUID();
      const payload = { eventId, videoId: id, processingVersion: 1, occurredAt: new Date().toISOString() };
      await db.query(
        `INSERT INTO video_processing_outbox(id,video_id,event_type,payload,next_attempt_at,published_at)
         VALUES($1,$2,'video.processing.requested.v1',$3,now(),now())`,
        [eventId, id, JSON.stringify(payload)],
      );
      await queue.add('process-video', payload, { jobId: `video-${id}-v1`, attempts: 3 });
    }
    if (process.env.SMOKE_ENQUEUE_ONLY === '1') {
      console.log(JSON.stringify({ id, status: 'enqueued' }));
      return;
    }
    let row;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      row = (await db.query(
        'SELECT status,failure_code,metadata,stream_key,thumbnail_key FROM videos WHERE id=$1',
        [id],
      )).rows[0];
      if (row.status === 'ready' || row.status === 'error' || (expectedStatus === 'processing' && row.status === 'processing')) break;
    }
    if (row.status !== expectedStatus || (expectedFailureCode && row.failure_code !== expectedFailureCode)) {
      throw new Error(`Unexpected processing result: ${JSON.stringify(row)}`);
    }
    if (expectedStatus === 'processing') {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET, Prefix: `videos/${id}/attempts/`,
      }));
      const count = (listed.Contents ?? []).length;
      if (process.env.SMOKE_DB_UNAVAILABLE === '1') {
        if (count !== 2) throw new Error(`Expected both derivatives retained, got ${count}`);
        console.log(JSON.stringify({ id, status: row.status, cleanupDeferred: true }));
      } else {
        if (count !== 0) throw new Error('Stale derivatives remain');
        console.log(JSON.stringify({ id, status: row.status, staleCleanup: true }));
      }
      return;
    }
    if (expectedStatus === 'error') {
      console.log(JSON.stringify({ id, status: row.status, failureCode: row.failure_code }));
      return;
    }
    await Promise.all([
      s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.stream_key })),
      s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.thumbnail_key })),
    ]);
    const [streamResponse, thumbnailResponse] = await Promise.all([
      s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.stream_key })),
      s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.thumbnail_key })),
    ]);
    const stream = Buffer.from(await streamResponse.Body.transformToByteArray());
    const thumbnail = Buffer.from(await thumbnailResponse.Body.transformToByteArray());
    const moov = stream.indexOf(Buffer.from('moov'));
    const mdat = stream.indexOf(Buffer.from('mdat'));
    if (moov < 0 || mdat < 0 || moov > mdat) throw new Error('MP4 is not faststart');
    if (thumbnail[0] !== 0xff || thumbnail[1] !== 0xd8 || thumbnail.at(-2) !== 0xff || thumbnail.at(-1) !== 0xd9) {
      throw new Error('Thumbnail is not JPEG');
    }
    const thumbnailPath = `/tmp/${id}-thumbnail.jpg`;
    writeFileSync(thumbnailPath, thumbnail);
    try {
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', thumbnailPath]).toString());
      const dimensions = probe.streams?.[0];
      if (!dimensions || dimensions.width > 640 || dimensions.height > 360 || dimensions.width * 240 !== dimensions.height * 320) {
        throw new Error('Thumbnail dimensions or aspect ratio are invalid');
      }
    } finally {
      unlinkSync(thumbnailPath);
    }
    if (row.metadata.format !== 'mp4' || row.metadata.videoCodec !== 'h264' || row.metadata.audioCodec !== 'aac') {
      throw new Error('Unexpected video metadata');
    }
    console.log(JSON.stringify({ id, status: row.status, metadata: row.metadata }));
  } finally {
    if (process.env.SMOKE_CLEANUP === '1') {
      try {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: `videos/${id}/` }));
        for (const object of listed.Contents ?? []) {
          if (object.Key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.Key }));
        }
        await db.query('DELETE FROM video_processing_outbox WHERE video_id=$1', [id]);
        await db.query('DELETE FROM video_upload_sessions WHERE video_id=$1', [id]);
        await db.query('DELETE FROM videos WHERE id=$1', [id]);
        await db.query('DELETE FROM channels WHERE id=$1', [channelId]);
        await db.query('DELETE FROM users WHERE id=$1', [userId]);
      } catch (cleanupError) {
        console.error('Smoke cleanup failed', cleanupError);
        process.exitCode = 1;
      }
    }
    await queue.close();
    await db.end();
    s3.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
