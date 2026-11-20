import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import request from 'supertest';
import {
  createVideoE2eHarness,
  type VideoE2eActor,
  type VideoE2eHarness,
} from './support/video-upload-e2e-harness';

describe('Private video delivery (e2e)', () => {
  let harness: VideoE2eHarness;
  let owner: VideoE2eActor;
  let stranger: VideoE2eActor;
  let video: Buffer;
  let thumbnail: Buffer;
  let publicId: string;

  async function storageRequest(url: string, method = 'GET', range?: string) {
    const signed = new URL(url);
    const internal = new URL(process.env.S3_INTERNAL_ENDPOINT!);
    return new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }>((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: internal.hostname,
          port: internal.port,
          path: `${signed.pathname}${signed.search}`,
          method,
          headers: { Host: signed.host, ...(range ? { Range: range } : {}) },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  }

  beforeAll(async () => {
    const previousTtl = process.env.VIDEO_URL_TTL_SECONDS;
    process.env.VIDEO_URL_TTL_SECONDS = '2';
    try {
      harness = await createVideoE2eHarness();
    } finally {
      if (previousTtl === undefined) delete process.env.VIDEO_URL_TTL_SECONDS;
      else process.env.VIDEO_URL_TTL_SECONDS = previousTtl;
    }
    [owner, stranger] = await Promise.all([
      harness.createActor(),
      harness.createActor(),
    ]);
    video = await readFile('test/fixtures/delivery.mp4');
    thumbnail = await readFile('test/fixtures/delivery.jpg');
    const id = randomUUID();
    publicId = randomBytes(16).toString('base64url');
    const sourceKey = `delivery-e2e/${id}/source.mp4`;
    const streamKey = `delivery-e2e/${id}/stream.mp4`;
    const thumbnailKey = `delivery-e2e/${id}/thumbnail.jpg`;
    await Promise.all([
      harness.storage.uploadStream(
        sourceKey,
        Readable.from(video),
        'video/mp4',
        video.length,
      ),
      harness.storage.uploadStream(
        streamKey,
        Readable.from(video),
        'video/mp4',
        video.length,
      ),
      harness.storage.uploadStream(
        thumbnailKey,
        Readable.from(thumbnail),
        'image/jpeg',
        thumbnail.length,
      ),
    ]);
    await harness.dataSource.query(
      `INSERT INTO videos(id,public_id,channel_id,title,original_filename,status,size_bytes,
       source_key,stream_key,thumbnail_key,duration_ms,metadata,processed_at)
       VALUES($1,$2,$3,'Delivery E2E','original.mp4','ready',$4,$5,$6,$7,1000,$8,now())`,
      [
        id,
        publicId,
        owner.channelId,
        video.length,
        sourceKey,
        streamKey,
        thumbnailKey,
        JSON.stringify({
          format: 'mp4',
          width: 320,
          height: 240,
          fps: { numerator: 24, denominator: 1 },
          videoCodec: 'h264',
          audioCodec: 'aac',
        }),
      ],
    );
  });

  afterAll(async () => {
    await harness.cleanActors([owner, stranger]);
    await harness.close();
  });

  it('redirects only the owner with a no-store signed URL', async () => {
    await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .expect(401);
    await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    const redirect = await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(307);
    expect(redirect.headers.location).toContain('X-Amz-Signature=');
    expect(redirect.headers['cache-control']).toBe('no-store');
  });

  it('serves valid and invalid ranges through storage', async () => {
    const redirect = await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(307);
    const first = await storageRequest(
      redirect.headers.location,
      'GET',
      'bytes=0-1023',
    );
    expect(first.status).toBe(206);
    expect(first.headers['content-range']).toBe(`bytes 0-1023/${video.length}`);
    expect(first.body).toEqual(video.subarray(0, 1024));
    const tail = await storageRequest(
      redirect.headers.location,
      'GET',
      `bytes=${video.length - 128}-`,
    );
    expect(tail.status).toBe(206);
    expect(tail.body).toEqual(video.subarray(video.length - 128));
    const invalid = await storageRequest(
      redirect.headers.location,
      'GET',
      `bytes=${video.length}-`,
    );
    expect(invalid.status).toBe(416);
  });

  it('signs HEAD and returns original download hash and JPEG', async () => {
    const auth = `Bearer ${owner.token}`;
    for (const kind of ['stream', 'download', 'thumbnail']) {
      const redirect = await request(harness.app.getHttpServer())
        .head(`/videos/${publicId}/${kind}`)
        .set('Authorization', auth)
        .expect(307);
      const response = await storageRequest(redirect.headers.location, 'HEAD');
      expect({ kind, status: response.status }).toEqual({ kind, status: 200 });
      expect(response.body).toHaveLength(0);
    }
    const download = await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/download`)
      .set('Authorization', auth)
      .expect(307);
    const original = await storageRequest(download.headers.location);
    expect(original.status).toBe(200);
    expect(original.headers['content-disposition']).toContain('attachment');
    expect(createHash('sha256').update(original.body).digest('hex')).toBe(
      createHash('sha256').update(video).digest('hex'),
    );
    const image = await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/thumbnail`)
      .set('Authorization', auth)
      .expect(307);
    const jpeg = await storageRequest(image.headers.location);
    expect(jpeg.status).toBe(200);
    expect(jpeg.body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('rejects non-ready media without exposing storage location', async () => {
    const draft = await harness.createUpload(owner);
    for (const status of ['draft', 'processing', 'error']) {
      if (status !== 'draft') {
        await harness.dataSource.query(
          'UPDATE videos SET status=$2,failure_code=$3 WHERE public_id=$1',
          [draft.publicId, status, status === 'error' ? 'INVALID_VIDEO' : null],
        );
      }
      const response = await request(harness.app.getHttpServer())
        .get(`/videos/${draft.publicId}/stream`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(409);
      expect(response.headers.location).toBeUndefined();
    }
  });

  it('keeps storage objects private without a signature', async () => {
    const redirect = await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(307);
    const unsigned = new URL(redirect.headers.location);
    unsigned.search = '';
    expect((await storageRequest(unsigned.toString())).status).toBe(403);
  });

  it('expires a signed URL and issues a fresh one', async () => {
    const auth = `Bearer ${owner.token}`;
    const first = await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Authorization', auth)
      .expect(307);
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect((await storageRequest(first.headers.location)).status).toBe(403);
    const renewed = await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Authorization', auth)
      .expect(307);
    expect((await storageRequest(renewed.headers.location)).status).toBe(200);
  });
});
