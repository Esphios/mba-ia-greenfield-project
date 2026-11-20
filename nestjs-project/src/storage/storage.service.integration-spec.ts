import { ConfigType } from '@nestjs/config';
import {
  DeleteBucketPolicyCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { ensureBucket } from './storage-init';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  const bucket = process.env.S3_BUCKET!;
  const endpoint = process.env.S3_INTERNAL_ENDPOINT!;
  const configuration = {
    backend: 'minio',
    internalEndpoint: endpoint,
    publicEndpoint: endpoint,
    region: process.env.S3_REGION!,
    bucket,
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: true,
    allowedOrigins: ['http://localhost:3000'],
    connectTimeoutMs: 5_000,
    controlTimeoutMs: 30_000,
    completeTimeoutMs: 120_000,
  } as ConfigType<typeof storageConfig>;
  const storage = new StorageService(configuration);
  const keys = new Set<string>();
  const uploads = new Map<string, string>();

  afterAll(async () => {
    for (const [key, uploadId] of uploads) {
      await storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
    }
    for (const key of keys) {
      await storage.deleteObject(key);
    }
  });

  it('executes multipart upload and rejects a different signed length', async () => {
    const key = `storage/${process.pid}-multipart.mp4`;
    keys.add(key);
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    uploads.set(key, uploadId);

    const expected = Buffer.alloc(5 * 1024 * 1024, 1);
    const wrongLengthUrl = await storage.signUploadPart(
      key,
      uploadId,
      1,
      expected.length,
      60,
    );
    const rejected = await fetch(wrongLengthUrl, {
      method: 'PUT',
      body: Buffer.alloc(expected.length - 1, 1),
    });
    expect(rejected.ok).toBe(false);

    const firstUrl = await storage.signUploadPart(
      key,
      uploadId,
      1,
      expected.length,
      60,
    );
    const first = await fetch(firstUrl, { method: 'PUT', body: expected });
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const parts = await storage.listParts(key, uploadId);
    expect(parts).toHaveLength(1);
    expect(parts[0].Size).toBe(expected.length);
    await storage.completeMultipartUpload(key, uploadId, [
      { PartNumber: 1, ETag: etag! },
    ]);
    uploads.delete(key);
    await expect(storage.headObject(key)).resolves.toMatchObject({
      ContentLength: expected.length,
      ContentType: 'video/mp4',
    });
  });

  it('resumes a real fixture larger than 64MiB without re-uploading part one', async () => {
    const key = `storage/${process.pid}-resume.mp4`;
    keys.add(key);
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    uploads.set(key, uploadId);
    const firstBytes = Buffer.alloc(67_108_864, 2);
    const firstUrl = await storage.signUploadPart(
      key,
      uploadId,
      1,
      firstBytes.length,
      120,
    );
    const firstResponse = await fetch(firstUrl, {
      method: 'PUT',
      body: firstBytes,
    });
    expect(firstResponse.status).toBe(200);
    const firstEtag = firstResponse.headers.get('etag')!;

    const confirmedBeforeResume = await storage.listParts(key, uploadId);
    expect(confirmedBeforeResume).toMatchObject([
      { PartNumber: 1, Size: firstBytes.length, ETag: firstEtag },
    ]);

    const secondUrl = await storage.signUploadPart(key, uploadId, 2, 1, 120);
    const secondResponse = await fetch(secondUrl, {
      method: 'PUT',
      body: Buffer.from([3]),
    });
    expect(secondResponse.status).toBe(200);
    const confirmedAfterResume = await storage.listParts(key, uploadId);
    expect(confirmedAfterResume[0].ETag).toBe(firstEtag);
    expect(confirmedAfterResume).toHaveLength(2);

    await storage.completeMultipartUpload(
      key,
      uploadId,
      confirmedAfterResume.map((part) => ({
        PartNumber: part.PartNumber,
        ETag: part.ETag,
      })),
    );
    uploads.delete(key);
    await expect(storage.headObject(key)).resolves.toMatchObject({
      ContentLength: 67_108_865,
    });
  });

  it('uploads/downloads bounded streams and signs GET separately from HEAD', async () => {
    const key = `storage/${process.pid}-stream.txt`;
    keys.add(key);
    await storage.uploadStream(
      key,
      Readable.from(Buffer.from('streamed')),
      'text/plain',
      8,
    );
    const body = await storage.downloadStream(key, 8);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('streamed');
    const limitedDownload = await storage.downloadStream(key, 7);
    await expect(
      (async () => {
        for await (const _chunk of limitedDownload) void _chunk;
      })(),
    ).rejects.toThrow('byte limit');

    const getUrl = await storage.signGet(key, 60);
    const headUrl = await storage.signHead(key, 60);
    expect(getUrl).not.toBe(headUrl);
    await expect(fetch(getUrl)).resolves.toMatchObject({ status: 200 });
    await expect(fetch(headUrl, { method: 'HEAD' })).resolves.toMatchObject({
      status: 200,
    });

    await expect(
      storage.uploadStream(
        `${key}-oversized`,
        Readable.from(Buffer.alloc(9)),
        'application/octet-stream',
        8,
      ),
    ).rejects.toThrow('byte limit');
  });

  it('aborts a real multipart upload and closes the producer after a late source failure', async () => {
    const key = `storage/${process.pid}-failed-stream.bin`;
    keys.add(key);
    let producerClosed = false;
    async function* failingSource(): AsyncGenerator<Buffer> {
      try {
        yield Buffer.alloc(67_108_864, 4);
        yield Buffer.alloc(1_048_576, 5);
        throw new Error('fixture source failed');
      } finally {
        producerClosed = true;
      }
    }

    await expect(
      storage.uploadStream(
        key,
        Readable.from(failingSource()),
        'application/octet-stream',
        70_000_000,
      ),
    ).rejects.toThrow('fixture source failed');

    expect(producerClosed).toBe(true);
    expect(
      (await storage.listMultipartUploads(key)).filter(
        (upload) => upload.Key === key,
      ),
    ).toHaveLength(0);
    await expect(storage.headObject(key)).rejects.toMatchObject({
      name: 'NotFound',
    });
  });

  it('keeps the bucket private and only exposes CORS for the allowed origin', async () => {
    const anonymous = await fetch(`${endpoint}/${bucket}/missing`);
    expect(anonymous.status).toBe(403);

    const allowed = await fetch(`${endpoint}/${bucket}/cors-probe`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'PUT',
      },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3000',
    );

    const forbidden = await fetch(`${endpoint}/${bucket}/cors-probe`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://forbidden.example',
        'Access-Control-Request-Method': 'PUT',
      },
    });
    expect(forbidden.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects a deliberately public real MinIO bucket and accepts it after restoration', async () => {
    const key = `storage/${process.pid}-public-policy-probe.txt`;
    keys.add(key);
    await storage.uploadStream(
      key,
      Readable.from(Buffer.from('private fixture')),
      'text/plain',
      15,
    );
    const client = new S3Client({
      endpoint,
      region: configuration.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    });
    const publicPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    });

    try {
      await client.send(
        new PutBucketPolicyCommand({ Bucket: bucket, Policy: publicPolicy }),
      );
      await expect(
        fetch(`${endpoint}/${bucket}/${key}`),
      ).resolves.toMatchObject({
        status: 200,
      });
      await expect(ensureBucket()).rejects.toThrow('anonymous object reads');
    } finally {
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
    }

    await expect(fetch(`${endpoint}/${bucket}/${key}`)).resolves.toMatchObject({
      status: 403,
    });
    await expect(ensureBucket()).resolves.toBeUndefined();
  });
});
