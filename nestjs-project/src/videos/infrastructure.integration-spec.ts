import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';

describe('video infrastructure (integration)', () => {
  const bucket = process.env.S3_BUCKET!;
  const objectKey = `integration/${process.pid}.txt`;
  const queueName = `infrastructure-${process.pid}`;
  const queuePrefix = process.env.VIDEO_QUEUE_PREFIX!;
  const storage = new S3Client({
    endpoint: process.env.S3_INTERNAL_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  const queue = new Queue(queueName, {
    prefix: queuePrefix,
    connection: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    },
  });

  afterAll(async () => {
    await storage.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('has an initialized private bucket and preserves real bytes', async () => {
    await expect(
      storage.send(new HeadBucketCommand({ Bucket: bucket })),
    ).resolves.toBeDefined();

    await storage.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: 'phase-03',
      }),
    );
    const response = await storage.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
    await expect(response.Body?.transformToString()).resolves.toBe('phase-03');

    const anonymousResponse = await fetch(
      `${process.env.S3_INTERNAL_ENDPOINT}/${bucket}/${objectKey}`,
    );
    expect(anonymousResponse.status).toBe(403);
  });

  it('uses the isolated Redis prefix and persists a BullMQ job', async () => {
    expect(queuePrefix).toBe('streamtube_phase03_test');
    const job = await queue.add('probe', { ready: true }, { jobId: 'probe' });
    await expect(queue.getJob(job.id!)).resolves.toMatchObject({ id: 'probe' });
  });
});
