import { DataSource } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { createHash, randomUUID } from 'node:crypto';
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http';
import { Readable } from 'node:stream';
import { deflateSync, gzipSync } from 'node:zlib';
import { JwtService } from '@nestjs/jwt';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import request from 'supertest';
import {
  createVideoE2eHarness,
  type VideoE2eActor,
  type VideoE2eHarness,
} from './support/video-upload-e2e-harness';

describe('Video upload control API (e2e)', () => {
  let harness: VideoE2eHarness;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let boundaryToken: string;
  let renewalToken: string;
  let actors: VideoE2eActor[];
  const body = {
    title: 'Video API',
    filename: 'video.mp4',
    sizeBytes: 67_108_865,
    contentType: 'video/mp4',
  };

  beforeAll(async () => {
    harness = await createVideoE2eHarness();
    dataSource = harness.dataSource;
  });

  beforeEach(async () => {
    actors = await Promise.all(
      Array.from({ length: 4 }, () => harness.createActor()),
    );
    [ownerToken, otherToken, boundaryToken, renewalToken] = actors.map(
      (actor) => actor.token,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await harness.cleanActors(actors);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('preserves auth and enforces owner-only resources', async () => {
    await request(harness.app.getHttpServer())
      .post('/videos')
      .send(body)
      .expect(401);

    const idempotencyKey = randomUUID();
    const canonicalBody = {
      ...body,
      title: `${' '.repeat(250)}Video API${' '.repeat(250)}`,
      filename: `folder/${' '.repeat(260)}video.mp4${' '.repeat(260)}`,
    };
    const created = await request(harness.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(canonicalBody)
      .expect(201);
    const publicId = created.body.video.publicId as string;
    expect(created.body.video).toMatchObject({
      title: 'Video API',
      publicId,
      canonicalUrl: `${process.env.API_PUBLIC_URL ?? 'http://localhost:3000'}/videos/${publicId}`,
    });
    expect(created.body.video.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.body.video).not.toHaveProperty('filename');
    await request(harness.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(canonicalBody)
      .expect(200)
      .expect(({ body: replay }) => {
        expect(replay.video.id).toBe(created.body.video.id);
        expect(replay.video.publicId).toBe(publicId);
        expect(replay.video.canonicalUrl).toBe(
          `${process.env.API_PUBLIC_URL ?? 'http://localhost:3000'}/videos/${publicId}`,
        );
      });
    expect(created.headers.location).toBe(`/videos/${publicId}`);

    await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'VIDEO_NOT_FOUND' }),
      );
    await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Host', 'attacker.invalid')
      .expect(200)
      .expect(({ body: video }) => {
        expect(video.id).toBe(created.body.video.id);
        expect(video.publicId).toBe(publicId);
        expect(video.canonicalUrl).toBe(
          `${process.env.API_PUBLIC_URL ?? 'http://localhost:3000'}/videos/${publicId}`,
        );
        expect(video).not.toHaveProperty('filename');
      });
    await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect(({ body: upload }) =>
        expect(upload).toMatchObject({
          state: 'uploading',
          partSize: 67_108_864,
          partCount: 2,
          uploadedParts: [],
        }),
      );
    await request(harness.app.getHttpServer())
      .post(`/videos/${publicId}/upload/parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ partNumbers: [1] })
      .expect(200);
  });

  it('replays canonical creation and completion without another draft or outbox event', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${ownerToken}` };
    const key = randomUUID();
    const firstBody = {
      ...body,
      title: ' Café ',
      filename: 'folder/movie.mp4',
      sizeBytes: 1,
    };
    const create = (payload: Record<string, unknown>) =>
      request(server)
        .post('/videos')
        .set(headers)
        .set('Idempotency-Key', key)
        .send(payload);
    const first = await create(firstBody).expect(201);
    const publicId = first.body.video.publicId as string;
    const videoId = first.body.video.id as string;
    expect(first.headers.location).toBe(`/videos/${publicId}`);

    for (const equivalent of [
      firstBody,
      { ...firstBody, title: 'Cafe\u0301', filename: 'movie.mp4' },
    ]) {
      const replay = await create(equivalent).expect(200);
      expect(replay.body.video).toMatchObject({ id: videoId, publicId });
      expect(replay.headers.location).toBe(first.headers.location);
    }
    await create({ ...firstBody, title: 'CAFÉ' })
      .expect(409)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' }),
      );
    await create({ ...firstBody, title: 'Ca fé' })
      .expect(409)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' }),
      );
    const [{ request_hash: requestHash }] = await dataSource.query<
      { request_hash: string }[]
    >('SELECT request_hash FROM video_upload_sessions WHERE video_id=$1', [
      videoId,
    ]);
    expect(requestHash).toBe(
      createHash('sha256')
        .update(JSON.stringify(['Café', 'movie.mp4', 1, 'video/mp4']))
        .digest('hex'),
    );
    const [{ drafts, sessions }] = await dataSource.query<
      { drafts: string; sessions: string }[]
    >(
      `SELECT (SELECT count(*)::text FROM videos WHERE channel_id=$1) AS drafts,
              (SELECT count(*)::text FROM video_upload_sessions WHERE channel_id=$1) AS sessions`,
      [actors[0].channelId],
    );
    expect({ drafts, sessions }).toEqual({ drafts: '1', sessions: '1' });

    const signed = await request(server)
      .post(`/videos/${publicId}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [1] })
      .expect(200);
    await expect(
      harness.putSignedPart(
        signed.body.parts[0].url as string,
        Buffer.from([1]),
      ),
    ).resolves.toBe(200);
    const queueBefore = await harness.queue.getJobCounts(
      'wait',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    for (let index = 0; index < 2; index += 1) {
      await request(server)
        .post(`/videos/${publicId}/upload/completion`)
        .set(headers)
        .expect(202)
        .expect(({ body: completion }) =>
          expect(completion).toMatchObject({ publicId, status: 'processing' }),
        );
    }
    expect(await harness.outboxCount(videoId)).toBe(1);
    expect(
      await harness.queue.getJobCounts(
        'wait',
        'active',
        'completed',
        'failed',
        'delayed',
      ),
    ).toEqual(queueBefore);
  });

  it('requires JWT and hides every upload resource from another owner', async () => {
    const server = harness.app.getHttpServer();
    const [first, second] = await Promise.all([
      harness.createUpload(actors[0]),
      harness.createUpload(actors[1]),
    ]);
    expect(first.publicId).not.toBe(second.publicId);
    const rows = await dataSource.query<{ id: string; channel_id: string }[]>(
      'SELECT id,channel_id FROM videos WHERE id=ANY($1)',
      [[first.id, second.id]],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: first.id, channel_id: actors[0].channelId },
        { id: second.id, channel_id: actors[1].channelId },
      ]),
    );

    await request(server)
      .post('/videos')
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(401);
    const calls = [
      () => request(server).get(`/videos/${first.publicId}`),
      () => request(server).get(`/videos/${first.publicId}/upload`),
      () =>
        request(server)
          .post(`/videos/${first.publicId}/upload/parts`)
          .send({ partNumbers: [1] }),
      () =>
        request(server)
          .post(`/videos/${first.publicId}/upload/completion`)
          .send({}),
      () => request(server).delete(`/videos/${first.publicId}/upload`),
    ];
    for (const call of calls) {
      await call().expect(401);
      await call()
        .set('Authorization', `Bearer ${actors[1].token}`)
        .expect(404)
        .expect(({ body: error }) => {
          expect(error).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
          expect(JSON.stringify(error)).not.toContain(first.id);
          expect(JSON.stringify(error)).not.toContain(first.publicId);
          expect(JSON.stringify(error)).not.toContain('source_key');
        });
    }
    expect(await harness.multipartUploads(first.publicId)).toBe(1);
    expect(await harness.multipartUploads(second.publicId)).toBe(1);
  });

  it('rejects invalid creation inputs before provisioning and normalizes accepted text', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${ownerToken}` };
    const multipartBefore = (
      await harness.storage.listMultipartUploads('videos/')
    ).length;
    const invalid: {
      payload: Record<string, unknown>;
      status: number;
      code: string;
    }[] = [
      {
        payload: { ...body, channelId: actors[1].channelId },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        payload: { ...body, key: 'injected' },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        payload: { ...body, sizeBytes: -1 },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        payload: { ...body, sizeBytes: '1' },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        payload: { ...body, sizeBytes: 10_000_000_001 },
        status: 413,
        code: 'VIDEO_TOO_LARGE',
      },
      {
        payload: { ...body, contentType: 'video/webm' },
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      },
      {
        payload: { ...body, filename: '' },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
      {
        payload: { ...body, filename: '.' },
        status: 400,
        code: 'VALIDATION_ERROR',
      },
    ];
    for (const { payload, status, code } of invalid) {
      await request(server)
        .post('/videos')
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .send(payload)
        .expect(status)
        .expect(({ body: error }) =>
          expect(error).toMatchObject({ error: code }),
        );
    }
    expect(
      (
        await dataSource.query<{ count: string }[]>(
          'SELECT count(*)::text AS count FROM videos WHERE channel_id=$1',
          [actors[0].channelId],
        )
      )[0].count,
    ).toBe('0');
    expect((await harness.storage.listMultipartUploads('videos/')).length).toBe(
      multipartBefore,
    );

    const accepted = await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...body,
        title: ' Cafe\u0301 ',
        filename: 'folder\\clip\u0000.mp4',
        sizeBytes: 1,
      })
      .expect(201);
    expect(accepted.body.video.title).toBe('Café');
    const [stored] = await dataSource.query<{ original_filename: string }[]>(
      'SELECT original_filename FROM videos WHERE id=$1',
      [accepted.body.video.id as string],
    );
    expect(stored.original_filename).toBe('clip.mp4');
  });

  it('enforces the control body limit on every video route', async () => {
    const server = harness.app.getHttpServer();
    const actor = actors[0];
    const { publicId } = await harness.createUpload(actor);
    const oversized = JSON.stringify({ pad: 'x'.repeat(66_000) });
    const calls = [
      () => request(server).post('/videos'),
      () => request(server).get(`/videos/${publicId}`),
      () => request(server).get(`/videos/${publicId}/upload`),
      () => request(server).post(`/videos/${publicId}/upload/parts`),
      () => request(server).post(`/videos/${publicId}/upload/completion`),
      () => request(server).delete(`/videos/${publicId}/upload`),
    ];
    for (const call of calls) {
      await call()
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Idempotency-Key', randomUUID())
        .set('Content-Type', 'application/json')
        .send(oversized)
        .expect(413)
        .expect(({ body: error }) =>
          expect(error).toMatchObject({ error: 'BODY_TOO_LARGE' }),
        );
    }
    expect((await harness.uploadRow(publicId)).state).toBe('uploading');
  });

  it('returns the catalogued validation, size, MIME and body-limit errors', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${ownerToken}` };
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', 'invalid')
      .send(body)
      .expect(400)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'VALIDATION_ERROR' }),
      );
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, sizeBytes: 10_000_000_001 })
      .expect(413)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'VIDEO_TOO_LARGE' }),
      );
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, contentType: 'video/webm' })
      .expect(415)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'UNSUPPORTED_MEDIA_TYPE' }),
      );
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, title: 'x'.repeat(66_000) })
      .expect(413)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'BODY_TOO_LARGE' }),
      );
    for (const invalid of [
      { ...body, title: '   ' },
      { ...body, filename: 'folder/..' },
    ]) {
      await request(server)
        .post('/videos')
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .send(invalid)
        .expect(400)
        .expect(({ body: error }) =>
          expect(error).toMatchObject({ error: 'VALIDATION_ERROR' }),
        );
    }
    const valid = await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(201);
    await request(server)
      .post(`/videos/${valid.body.video.publicId as string}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [3] })
      .expect(400)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'VALIDATION_ERROR' }),
      );
  });

  it('maps storage failures in listing, completion and abort to 503', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${otherToken}` };
    const storage = harness.storage;
    const create = async () => {
      const response = await request(server)
        .post('/videos')
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(201);
      const publicId = response.body.video.publicId as string;
      return publicId;
    };
    const listingAndAbortId = await create();
    jest
      .spyOn(storage, 'listParts')
      .mockRejectedValueOnce(new Error('offline'));
    await request(server)
      .get(`/videos/${listingAndAbortId}/upload`)
      .set(headers)
      .expect(503)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'STORAGE_UNAVAILABLE' }),
      );

    const completingId = await create();
    jest
      .spyOn(storage, 'listParts')
      .mockRejectedValueOnce(new Error('offline'));
    await request(server)
      .post(`/videos/${completingId}/upload/completion`)
      .set(headers)
      .expect(503)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'STORAGE_UNAVAILABLE' }),
      );

    jest
      .spyOn(storage, 'abortMultipartUpload')
      .mockRejectedValueOnce(new Error('offline'));
    await request(server)
      .delete(`/videos/${listingAndAbortId}/upload`)
      .set(headers)
      .expect(503)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'STORAGE_UNAVAILABLE' }),
      );
    jest.restoreAllMocks();
  });

  it('counts actual bytes for chunked bodies and accepts the inclusive boundary', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${boundaryToken}` };
    const base = { ...body, title: 'Video boundary' };
    const baseJson = JSON.stringify(base);
    const exactJson = JSON.stringify({
      ...base,
      title: `${base.title}${' '.repeat(65_536 - Buffer.byteLength(baseJson))}`,
    });
    expect(Buffer.byteLength(exactJson)).toBe(65_536);
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send(exactJson)
      .expect(201);

    const oversizedJson = JSON.stringify({
      ...body,
      title: `Video${' '.repeat(66_000)}`,
    });
    const address = (harness.app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a listening TCP server');
    }
    const chunked = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const outgoing = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/videos',
            method: 'POST',
            headers: {
              Authorization: `Bearer ${boundaryToken}`,
              'Idempotency-Key': randomUUID(),
              'Content-Type': 'application/json',
              'Transfer-Encoding': 'chunked',
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        outgoing.on('error', reject);
        const split = Math.floor(oversizedJson.length / 3);
        outgoing.write(oversizedJson.slice(0, split));
        outgoing.write(oversizedJson.slice(split, split * 2));
        outgoing.end(oversizedJson.slice(split * 2));
      },
    );
    expect(chunked.status).toBe(413);
    expect(JSON.parse(chunked.body)).toMatchObject({ error: 'BODY_TOO_LARGE' });
  });

  it('maps parser boundaries, encodings, malformed JSON and media types uniformly', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${renewalToken}` };
    const baseJson = JSON.stringify({ ...body, title: 'Parser boundary' });
    const sized = (bytes: number) =>
      `${baseJson}${' '.repeat(bytes - Buffer.byteLength(baseJson))}`;
    expect(Buffer.byteLength(sized(65_535))).toBe(65_535);
    expect(Buffer.byteLength(sized(65_536))).toBe(65_536);
    expect(Buffer.byteLength(sized(65_537))).toBe(65_537);
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send(sized(65_535))
      .expect(201);
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send(sized(65_536))
      .expect(201);
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send(sized(65_537))
      .expect(413)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'BODY_TOO_LARGE' }),
      );
    const address = (server as Server).address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a listening TCP server');
    const sendCompressed = (encoding: 'gzip' | 'deflate', compressed: Buffer) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const outgoing = httpRequest(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/videos',
            method: 'POST',
            headers: {
              ...headers,
              'Idempotency-Key': randomUUID(),
              'Content-Type': 'application/json',
              'Content-Encoding': encoding,
              'Content-Length': compressed.length,
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            );
          },
        );
        outgoing.on('error', reject);
        outgoing.end(compressed);
      });
    for (const [encoding, compressed] of [
      ['gzip', gzipSync(Buffer.from(sized(65_537)))],
      ['deflate', deflateSync(Buffer.from(sized(65_537)))],
    ] as const) {
      const compressedResponse = await sendCompressed(encoding, compressed);
      expect(compressedResponse.status).toBe(413);
      expect(JSON.parse(compressedResponse.body)).toMatchObject({
        error: 'BODY_TOO_LARGE',
      });
    }
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"title":')
      .expect(400)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'VALIDATION_ERROR' }),
      );
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json; charset=latin1')
      .send(JSON.stringify(body))
      .expect(415);
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(body))
      .expect(415);
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ pad: 'x'.repeat(120_000) }))
      .expect(413);
  });

  it('rejects suffix JSON and every non-object control body before a claim', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${renewalToken}` };
    const [{ count: before }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_upload_sessions',
    );
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/vnd.example+json')
      .send(JSON.stringify(body))
      .expect(415);
    for (const value of [[], null, 'text', 1, true, {}]) {
      await request(server)
        .post('/videos')
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .set('Content-Type', 'application/json; charset=utf-8')
        .send(JSON.stringify(value))
        .expect(400)
        .expect(({ body: error }) =>
          expect(error).toMatchObject({ error: 'VALIDATION_ERROR' }),
        );
    }
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send()
      .expect(400);
    const [{ count: after }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_upload_sessions',
    );
    expect(after).toBe(before);
  });

  it('resumes and completes a real multipart upload larger than 64MiB through HTTP control', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${boundaryToken}` };
    const created = await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, title: 'Large resumed upload' })
      .expect(201);
    const publicId = created.body.video.publicId as string;

    const firstSigning = await request(server)
      .post(`/videos/${publicId}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [1] })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const firstPart = firstSigning.body.parts[0] as {
      url: string;
      expectedSizeBytes: number;
    };
    await expect(
      harness.putSignedPart(
        firstPart.url,
        Buffer.alloc(firstPart.expectedSizeBytes, 7),
      ),
    ).resolves.toBe(200);

    await request(server)
      .get(`/videos/${publicId}/upload`)
      .set(headers)
      .expect(200)
      .expect(({ body: upload }) => {
        expect(upload.uploadedParts).toHaveLength(1);
        expect(upload.uploadedParts[0]).toMatchObject({
          partNumber: 1,
          sizeBytes: 67_108_864,
        });
      });
    await request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .send({ unexpected: true })
      .expect(400)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'VALIDATION_ERROR' }),
      );
    await request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(409)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'UPLOAD_INCOMPLETE' }),
      );

    const secondSigning = await request(server)
      .post(`/videos/${publicId}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [2] })
      .expect(200);
    const secondPart = secondSigning.body.parts[0] as { url: string };
    await expect(
      harness.putSignedPart(secondPart.url, Buffer.from([8])),
    ).resolves.toBe(200);

    await request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(202)
      .expect(({ body: completion }) =>
        expect(completion).toMatchObject({ status: 'processing' }),
      );
  });

  it('rejects an expired signed PUT and accepts a renewed URL for the same part', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${renewalToken}` };
    const created = await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, title: 'Signed URL renewal', sizeBytes: 1 })
      .expect(201);
    const publicId = created.body.video.publicId as string;

    const sign = async (): Promise<{ url: string; expiresAt: string }> => {
      const response = await request(server)
        .post(`/videos/${publicId}/upload/parts`)
        .set(headers)
        .send({ partNumbers: [1] })
        .expect(200);
      return response.body.parts[0] as { url: string; expiresAt: string };
    };

    const first = await sign();
    expect(new URL(first.url).searchParams.get('X-Amz-Expires')).toBe('2');
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    await expect(
      harness.putSignedPart(first.url, Buffer.from([1])),
    ).resolves.toBe(403);

    const renewed = await sign();
    expect(renewed.url).not.toBe(first.url);
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(
      Date.parse(first.expiresAt),
    );
    await expect(
      harness.putSignedPart(renewed.url, Buffer.from([1])),
    ).resolves.toBe(200);
    await request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(202);
  });

  it('rejects an oversized signed PUT and accepts the correct part on the same upload', async () => {
    const actor = actors[0];
    const { publicId, id } = await harness.createUpload(actor);
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const sign = async (): Promise<string> => {
      const response = await request(server)
        .post(`/videos/${publicId}/upload/parts`)
        .set(headers)
        .send({ partNumbers: [1] })
        .expect(200);
      return response.body.parts[0].url as string;
    };
    const firstUrl = await sign();
    expect(await harness.putSignedPart(firstUrl, Buffer.from([1, 2]))).not.toBe(
      200,
    );
    expect((await harness.uploadRow(publicId)).state).toBe('uploading');
    const renewedUrl = await sign();
    await expect(
      harness.putSignedPart(renewedUrl, Buffer.from([1])),
    ).resolves.toBe(200);
    await request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(202);
    expect(await harness.outboxCount(id)).toBe(1);
  });

  it('uses the database clock when signing a session close to expiry', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${renewalToken}` };
    const created = await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, title: 'Database clock signing', sizeBytes: 1 })
      .expect(201);
    const publicId = created.body.video.publicId as string;
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()+interval '70 seconds'
       WHERE video_id=(SELECT id FROM videos WHERE public_id=$1)`,
      [publicId],
    );

    const actualNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(actualNow + 120_000);
    try {
      const signed = await request(server)
        .post(`/videos/${publicId}/upload/parts`)
        .set(headers)
        .send({ partNumbers: [1] })
        .expect(200);
      expect(
        new URL(signed.body.parts[0].url as string).searchParams.get(
          'X-Amz-Expires',
        ),
      ).toBe('2');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('caps signed TTL to the database remainder and never signs completing uploads', async () => {
    const actor = actors[0];
    const { publicId, id } = await harness.createUpload(actor);
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const sign = () =>
      request(server)
        .post(`/videos/${publicId}/upload/parts`)
        .set(headers)
        .send({ partNumbers: [1] });
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()+interval '59 seconds'
       WHERE video_id=$1`,
      [id],
    );
    const long = await sign().expect(200);
    expect(
      new URL(long.body.parts[0].url as string).searchParams.get(
        'X-Amz-Expires',
      ),
    ).toBe('2');
    expect(
      Date.parse(long.body.parts[0].expiresAt as string),
    ).toBeLessThanOrEqual(
      (await harness.uploadRow(publicId)).expires_at.getTime(),
    );

    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()+interval '1.8 seconds'
       WHERE video_id=$1`,
      [id],
    );
    const short = await sign().expect(200);
    expect(
      new URL(short.body.parts[0].url as string).searchParams.get(
        'X-Amz-Expires',
      ),
    ).toBe('1');
    expect(
      Date.parse(short.body.parts[0].expiresAt as string),
    ).toBeLessThanOrEqual(
      (await harness.uploadRow(publicId)).expires_at.getTime(),
    );

    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()-interval '1 second'
       WHERE video_id=$1`,
      [id],
    );
    const signStorage = jest.spyOn(harness.storage, 'signUploadPart');
    await sign().expect(410);
    expect(signStorage).not.toHaveBeenCalled();

    const completing = await harness.createUpload(actors[1]);
    await dataSource.query(
      `UPDATE video_upload_sessions SET state='completing' WHERE video_id=$1`,
      [completing.id],
    );
    await request(server)
      .post(`/videos/${completing.publicId}/upload/parts`)
      .set('Authorization', `Bearer ${actors[1].token}`)
      .send({ partNumbers: [1] })
      .expect(409);
    expect(signStorage).not.toHaveBeenCalled();
  });

  it('expires an upload through explicit maintenance and preserves its draft', async () => {
    const actor = actors[0];
    const { publicId, id } = await harness.createUpload(actor);
    expect(await harness.multipartUploads(publicId)).toBe(1);
    const before = await harness.dbClock();
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()-interval '1 second'
       WHERE video_id=$1`,
      [id],
    );

    await harness.runExpirationMaintenance();
    const after = await harness.dbClock();
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    const headers = { Authorization: `Bearer ${actor.token}` };
    await request(harness.app.getHttpServer())
      .post(`/videos/${publicId}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [1] })
      .expect(410);
    await request(harness.app.getHttpServer())
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(410);
    const row = await harness.uploadRow(publicId);
    expect(row.state).toBe('expired');
    expect(row.quota_released_at).not.toBeNull();
    expect(await harness.multipartUploads(publicId)).toBe(0);
    expect(await harness.outboxCount(id)).toBe(0);
    await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}`)
      .set(headers)
      .expect(200)
      .expect(({ body: video }) =>
        expect(video).toMatchObject({ id, status: 'draft' }),
      );
  });

  it('returns retry guidance for completing and replays the persisted video status', async () => {
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${ownerToken}` };
    const created = await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(201);
    const publicId = created.body.video.publicId as string;
    const [{ id: videoId }] = await dataSource.query<{ id: string }[]>(
      'SELECT id FROM videos WHERE public_id=$1',
      [publicId],
    );
    await dataSource.query(
      `UPDATE video_upload_sessions SET state='completing'
       WHERE video_id=$1`,
      [videoId],
    );
    await request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(409)
      .expect('Retry-After', '5');

    await dataSource.query(
      `UPDATE video_upload_sessions SET state='completed'
       WHERE video_id=$1`,
      [videoId],
    );
    const [{ count: countBefore }] = await dataSource.query<
      { count: string }[]
    >('SELECT count(*)::text count FROM video_processing_outbox');
    for (const status of ['processing', 'ready', 'error']) {
      await dataSource.query(
        `UPDATE videos SET status=$2::varchar,
           stream_key=CASE WHEN $2::varchar='ready' THEN 'stream.mp4' ELSE stream_key END,
           thumbnail_key=CASE WHEN $2::varchar='ready' THEN 'thumb.jpg' ELSE thumbnail_key END,
           duration_ms=CASE WHEN $2::varchar='ready' THEN 1000 ELSE duration_ms END,
           metadata=CASE WHEN $2::varchar='ready' THEN '{}'::jsonb ELSE metadata END,
           failure_code=CASE WHEN $2::varchar='error' THEN 'PROCESSING_FAILED' ELSE failure_code END
         WHERE id=$1`,
        [videoId, status],
      );
      await request(server)
        .post(`/videos/${publicId}/upload/completion`)
        .set(headers)
        .expect(202)
        .expect(({ body: response }) =>
          expect(response).toMatchObject({ status }),
        );
    }
    const [{ count: countAfter }] = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text count FROM video_processing_outbox',
    );
    expect(countAfter).toBe(countBefore);
  });

  it('maps admission quota failures to 429 without consuming a third slot', async () => {
    const create = () =>
      request(harness.app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...body, title: `Video ${randomUUID()}` });

    await create().expect(201);
    await create().expect(201);
    await create()
      .expect(429)
      .expect(({ body: error }) =>
        expect(error).toMatchObject({ error: 'UPLOAD_QUOTA_EXCEEDED' }),
      );
  });

  it('enforces ten global reservations across six owners under concurrent admission', async () => {
    actors.push(await harness.createActor(), await harness.createActor());
    const initial = await dataSource.query<{ count: string }[]>(
      'SELECT count(*)::text AS count FROM video_upload_sessions WHERE quota_released_at IS NULL',
    );
    expect(initial[0].count).toBe('0');
    const create = (actor: VideoE2eActor) =>
      request(harness.app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...body, title: `Quota ${randomUUID()}`, sizeBytes: 1 });
    const admitted = await Promise.all(
      actors.slice(0, 5).flatMap((actor) => [create(actor), create(actor)]),
    );
    expect(admitted.map((response) => response.status)).toEqual(
      Array(10).fill(201),
    );
    const rejected = await Promise.all([create(actors[0]), create(actors[5])]);
    for (const response of rejected) {
      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({ error: 'UPLOAD_QUOTA_EXCEEDED' });
    }
    const counts = await dataSource.query<
      { channel_id: string; count: string }[]
    >(
      `SELECT channel_id,count(*)::text AS count FROM video_upload_sessions
       WHERE quota_released_at IS NULL GROUP BY channel_id`,
    );
    expect(counts).toHaveLength(5);
    expect(counts.every(({ count }) => count === '2')).toBe(true);
    expect(
      await dataSource.query<{ id: string }[]>(
        'SELECT id FROM videos WHERE channel_id=$1',
        [actors[5].channelId],
      ),
    ).toHaveLength(0);
    expect(
      await dataSource.query<{ id: string }[]>(
        'SELECT id FROM video_upload_sessions WHERE channel_id=$1',
        [actors[5].channelId],
      ),
    ).toHaveLength(0);
  });

  it('distinguishes rate limit 429 and its retry header from upload quota', async () => {
    const storage = harness.app.get<ThrottlerStorageService>(ThrottlerStorage);
    storage.storage.clear();
    const { publicId } = await harness.createUpload(actors[0]);
    const getVideo = () =>
      request(harness.app.getHttpServer())
        .get(`/videos/${publicId}`)
        .set('Authorization', `Bearer ${actors[0].token}`);
    for (let index = 0; index < 120; index += 1) {
      await getVideo().expect(200);
    }
    const limited = await getVideo().expect(429);
    expect(limited.body.error).not.toBe('UPLOAD_QUOTA_EXCEEDED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    storage.storage.clear();
  });

  it('keeps processing and failed abort cleanup reserved until cleanup succeeds once', async () => {
    const actor = actors[0];
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const processing = await harness.createUpload(actor);
    const aborting = await harness.createUpload(actor);
    const signed = await request(server)
      .post(`/videos/${processing.publicId}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [1] })
      .expect(200);
    await expect(
      harness.putSignedPart(
        signed.body.parts[0].url as string,
        Buffer.from([1]),
      ),
    ).resolves.toBe(200);
    await request(server)
      .post(`/videos/${processing.publicId}/upload/completion`)
      .set(headers)
      .expect(202);
    expect(
      (await harness.uploadRow(processing.publicId)).quota_released_at,
    ).toBeNull();

    jest
      .spyOn(harness.storage, 'abortMultipartUpload')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await request(server)
      .delete(`/videos/${aborting.publicId}/upload`)
      .set(headers)
      .expect(503);
    expect((await harness.uploadRow(aborting.publicId)).state).toBe('aborted');
    expect(
      (await harness.uploadRow(aborting.publicId)).quota_released_at,
    ).toBeNull();
    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, sizeBytes: 1 })
      .expect(429);

    jest.restoreAllMocks();
    await Promise.all([
      harness.runExpirationMaintenance(),
      harness.runExpirationMaintenance(),
    ]);
    const released = await harness.uploadRow(aborting.publicId);
    expect(released.quota_released_at).not.toBeNull();
    expect(await harness.multipartUploads(aborting.publicId)).toBe(0);
    await request(server)
      .delete(`/videos/${aborting.publicId}/upload`)
      .set(headers)
      .expect(204);
    await harness.runExpirationMaintenance();
    expect(
      (await harness.uploadRow(aborting.publicId)).quota_released_at,
    ).toEqual(released.quota_released_at);
    expect(
      (await harness.uploadRow(processing.publicId)).quota_released_at,
    ).toBeNull();
    await harness.createUpload(actor);
  });

  it('holds an expired reservation while remote cleanup is unavailable', async () => {
    const actor = actors[0];
    const expiring = await harness.createUpload(actor);
    await harness.createUpload(actor);
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()-interval '1 second'
       WHERE video_id=$1`,
      [expiring.id],
    );
    jest
      .spyOn(harness.storage, 'abortMultipartUpload')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await harness.runExpirationMaintenance();
    expect((await harness.uploadRow(expiring.publicId)).state).toBe('expired');
    expect(
      (await harness.uploadRow(expiring.publicId)).quota_released_at,
    ).toBeNull();
    const createThird = () =>
      request(harness.app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...body, sizeBytes: 1 });
    await createThird().expect(429);

    jest.restoreAllMocks();
    await dataSource.query(
      `UPDATE video_cleanup_obligations
       SET next_attempt_at=clock_timestamp()-interval '1 second'
       WHERE session_id=(SELECT id FROM video_upload_sessions WHERE video_id=$1)`,
      [expiring.id],
    );
    await Promise.all([
      harness.runExpirationMaintenance(),
      harness.runExpirationMaintenance(),
    ]);
    const releasedAt = (await harness.uploadRow(expiring.publicId))
      .quota_released_at;
    expect(releasedAt).not.toBeNull();
    expect(await harness.multipartUploads(expiring.publicId)).toBe(0);
    await request(harness.app.getHttpServer())
      .delete(`/videos/${expiring.publicId}/upload`)
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(204);
    await harness.runExpirationMaintenance();
    expect(
      (await harness.uploadRow(expiring.publicId)).quota_released_at,
    ).toEqual(releasedAt);
    await createThird().expect(201);
  });

  it('aborts an active upload idempotently and rejects abort in completing or completed', async () => {
    const server = harness.app.getHttpServer();
    const active = await harness.createUpload(actors[0]);
    const activeHeaders = { Authorization: `Bearer ${actors[0].token}` };
    await request(server)
      .delete(`/videos/${active.publicId}/upload`)
      .set(activeHeaders)
      .expect(204);
    await request(server)
      .delete(`/videos/${active.publicId}/upload`)
      .set(activeHeaders)
      .expect(204);
    expect((await harness.uploadRow(active.publicId)).state).toBe('aborted');
    await harness.runExpirationMaintenance();
    expect(await harness.multipartUploads(active.publicId)).toBe(0);
    await request(server)
      .get(`/videos/${active.publicId}`)
      .set(activeHeaders)
      .expect(200)
      .expect(({ body: video }) =>
        expect(video).toMatchObject({ status: 'draft' }),
      );

    const completing = await harness.createUpload(actors[1]);
    await dataSource.query(
      `UPDATE video_upload_sessions SET state='completing' WHERE video_id=$1`,
      [completing.id],
    );
    await request(server)
      .delete(`/videos/${completing.publicId}/upload`)
      .set('Authorization', `Bearer ${actors[1].token}`)
      .expect(409);

    const completed = await harness.createUpload(actors[2]);
    const completedHeaders = { Authorization: `Bearer ${actors[2].token}` };
    const signed = await request(server)
      .post(`/videos/${completed.publicId}/upload/parts`)
      .set(completedHeaders)
      .send({ partNumbers: [1] })
      .expect(200);
    await expect(
      harness.putSignedPart(
        signed.body.parts[0].url as string,
        Buffer.from([1]),
      ),
    ).resolves.toBe(200);
    await request(server)
      .post(`/videos/${completed.publicId}/upload/completion`)
      .set(completedHeaders)
      .expect(202);
    await request(server)
      .delete(`/videos/${completed.publicId}/upload`)
      .set(completedHeaders)
      .expect(409);
  });

  it('protects completion accepted before expiry while S3 responds after expiry', async () => {
    const actor = actors[0];
    const { publicId, id } = await harness.createUpload(actor);
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const signed = await request(server)
      .post(`/videos/${publicId}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [1] })
      .expect(200);
    await expect(
      harness.putSignedPart(
        signed.body.parts[0].url as string,
        Buffer.from([1]),
      ),
    ).resolves.toBe(200);
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()+interval '1 second'
       WHERE video_id=$1`,
      [id],
    );

    const listParts = harness.storage.listParts.bind(harness.storage);
    let entered!: () => void;
    let release!: () => void;
    const enteredStorage = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releaseStorage = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest
      .spyOn(harness.storage, 'listParts')
      .mockImplementation(async (key, uploadId) => {
        entered();
        await releaseStorage;
        return listParts(key, uploadId);
      });
    const completion = request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(202);
    const completed = completion.then((response) => response);
    try {
      await enteredStorage;
      expect((await harness.uploadRow(publicId)).state).toBe('completing');
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await harness.runExpirationMaintenance();
      expect((await harness.uploadRow(publicId)).state).toBe('completing');
    } finally {
      release();
    }
    await completed;
    jest.restoreAllMocks();
    expect((await harness.uploadRow(publicId)).state).toBe('completed');
    expect(
      (
        await harness.storage.headObject(
          (await harness.uploadRow(publicId)).source_key,
        )
      ).ContentLength,
    ).toBe(1);
    expect((await harness.uploadRow(publicId)).quota_released_at).toBeNull();
    expect(await harness.outboxCount(id)).toBe(1);
    await request(server)
      .post(`/videos/${publicId}/upload/completion`)
      .set(headers)
      .expect(202)
      .expect(({ body: video }) =>
        expect(video).toMatchObject({ status: 'processing' }),
      );
    expect(await harness.outboxCount(id)).toBe(1);
  });

  it('recovers incomplete post-CAS completions before and after the upload deadline', async () => {
    const server = harness.app.getHttpServer();
    for (const [index, actor] of actors.slice(0, 2).entries()) {
      const upload = await harness.createUpload(actor);
      const headers = { Authorization: `Bearer ${actor.token}` };
      jest
        .spyOn(harness.storage, 'listParts')
        .mockRejectedValueOnce(new Error('crash after completing claim'));
      await request(server)
        .post(`/videos/${upload.publicId}/upload/completion`)
        .set(headers)
        .expect(503);
      jest.restoreAllMocks();
      expect((await harness.uploadRow(upload.publicId)).state).toBe(
        'completing',
      );
      await dataSource.query(
        `UPDATE video_upload_sessions
         SET operation_until=clock_timestamp()-interval '1 second',
             expires_at=CASE WHEN $2::boolean
               THEN clock_timestamp()-interval '1 second' ELSE expires_at END
         WHERE video_id=$1`,
        [upload.id, index === 1],
      );
      await harness.reconciler.reconcileCompleting();
      const expectedState = index === 0 ? 'uploading' : 'expired';
      expect((await harness.uploadRow(upload.publicId)).state).toBe(
        expectedState,
      );
      await request(server)
        .post(`/videos/${upload.publicId}/upload/completion`)
        .set(headers)
        .expect(index === 0 ? 409 : 410)
        .expect(({ body: error }) =>
          expect(error).toMatchObject({
            error: index === 0 ? 'UPLOAD_INCOMPLETE' : 'UPLOAD_EXPIRED',
          }),
        );
      if (index === 1) {
        await harness.runExpirationMaintenance();
        expect(await harness.multipartUploads(upload.publicId)).toBe(0);
      } else {
        expect(await harness.multipartUploads(upload.publicId)).toBe(1);
      }
      expect(await harness.outboxCount(upload.id)).toBe(0);
    }
  });

  it('aborts completion with 422 when a real object diverges at the HEAD boundary', async () => {
    const actor = actors[0];
    const upload = await harness.createUpload(actor);
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const signed = await request(server)
      .post(`/videos/${upload.publicId}/upload/parts`)
      .set(headers)
      .send({ partNumbers: [1] })
      .expect(200);
    await expect(
      harness.putSignedPart(
        signed.body.parts[0].url as string,
        Buffer.from([1]),
      ),
    ).resolves.toBe(200);

    const headObject = harness.storage.headObject.bind(harness.storage);
    let entered!: () => void;
    let release!: () => void;
    const enteredHead = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releaseHead = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest
      .spyOn(harness.storage, 'headObject')
      .mockImplementation(async (key) => {
        entered();
        await releaseHead;
        return headObject(key);
      });
    const completion = request(server)
      .post(`/videos/${upload.publicId}/upload/completion`)
      .set(headers)
      .expect(422);
    const completed = completion.then((response) => response);
    try {
      await enteredHead;
      const row = await harness.uploadRow(upload.publicId);
      await harness.storage.uploadStream(
        row.source_key,
        Readable.from([Buffer.from([1, 2])]),
        'video/mp4',
        2,
      );
    } finally {
      release();
    }
    const response = await completed;
    jest.restoreAllMocks();
    expect(response.body).toMatchObject({ error: 'UPLOAD_SIZE_MISMATCH' });
    expect((await harness.uploadRow(upload.publicId)).state).toBe('aborted');
    expect(await harness.outboxCount(upload.id)).toBe(0);
    await expect(
      harness.storage.headObject(
        (await harness.uploadRow(upload.publicId)).source_key,
      ),
    ).rejects.toMatchObject({ name: 'NotFound' });
  });

  it('recovers a post-CAS crash against a divergent real storage object without a job', async () => {
    const actor = actors[0];
    const upload = await harness.createUpload(actor);
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    jest
      .spyOn(harness.storage, 'listParts')
      .mockRejectedValueOnce(new Error('crash after completing claim'));
    await request(server)
      .post(`/videos/${upload.publicId}/upload/completion`)
      .set(headers)
      .expect(503);
    jest.restoreAllMocks();
    const row = await harness.uploadRow(upload.publicId);
    expect(row.state).toBe('completing');
    await harness.storage.uploadStream(
      row.source_key,
      Readable.from([Buffer.from([1, 2])]),
      'video/mp4',
      2,
    );
    await dataSource.query(
      `UPDATE video_upload_sessions SET operation_until=clock_timestamp()-interval '1 second'
       WHERE video_id=$1`,
      [upload.id],
    );
    await harness.reconciler.reconcileCompleting();
    expect((await harness.uploadRow(upload.publicId)).state).toBe('aborted');
    await request(server)
      .post(`/videos/${upload.publicId}/upload/completion`)
      .set(headers)
      .expect(409);
    expect(await harness.outboxCount(upload.id)).toBe(0);
    await harness.runExpirationMaintenance();
    await expect(
      harness.storage.headObject(row.source_key),
    ).rejects.toMatchObject({ name: 'NotFound' });
  });

  it('replays a persisted initiating draft during delayed provisioning with one lease', async () => {
    const actor = actors[0];
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const key = randomUUID();
    const payload = { ...body, title: 'Delayed provisioning', sizeBytes: 1 };
    const create = () =>
      request(server)
        .post('/videos')
        .set(headers)
        .set('Idempotency-Key', key)
        .send(payload);
    const createMultipart = harness.storage.createMultipartUpload.bind(
      harness.storage,
    );
    let entered!: () => void;
    let release!: () => void;
    const enteredStorage = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releaseStorage = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provision = jest
      .spyOn(harness.storage, 'createMultipartUpload')
      .mockImplementation(async (storageKey, contentType) => {
        entered();
        await releaseStorage;
        return createMultipart(storageKey, contentType);
      });
    const pending = create()
      .expect(201)
      .then((response) => response);
    let publicId: string;
    try {
      await enteredStorage;
      const [draft] = await dataSource.query<{ public_id: string }[]>(
        `SELECT v.public_id FROM videos v JOIN video_upload_sessions s ON s.video_id=v.id
         WHERE s.idempotency_key=$1 AND s.channel_id=$2`,
        [key, actor.channelId],
      );
      publicId = draft.public_id;
      const replays = await Promise.all([
        create().expect(200),
        create().expect(200),
      ]);
      for (const replay of replays) {
        expect(replay.body.video.publicId).toBe(publicId);
        expect(replay.body.upload).toMatchObject({
          state: 'initiating',
          lastErrorCode: null,
        });
        expect(replay.headers['retry-after']).toBe('5');
      }
      await request(server)
        .get(`/videos/${publicId}/upload`)
        .set(headers)
        .expect(200)
        .expect('Retry-After', '5')
        .expect(({ body: upload }) =>
          expect(upload).toMatchObject({
            state: 'initiating',
            uploadedParts: [],
          }),
        );
      expect(provision).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    const created = await pending;
    jest.restoreAllMocks();
    expect(created.body.video.publicId).toBe(publicId!);
    expect(created.body.upload.state).toBe('uploading');
    expect(await harness.multipartUploads(publicId!)).toBe(1);
  });

  it('retries provisioning after 503 without replacing the persisted draft', async () => {
    const actor = actors[0];
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const key = randomUUID();
    const payload = { ...body, sizeBytes: 1 };
    const create = () =>
      request(server)
        .post('/videos')
        .set(headers)
        .set('Idempotency-Key', key)
        .send(payload);
    jest
      .spyOn(harness.storage, 'createMultipartUpload')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await create().expect(503);
    jest.restoreAllMocks();
    const [draft] = await dataSource.query<{ id: string; public_id: string }[]>(
      `SELECT v.id,v.public_id FROM videos v JOIN video_upload_sessions s ON s.video_id=v.id
       WHERE s.idempotency_key=$1 AND s.channel_id=$2`,
      [key, actor.channelId],
    );
    await request(server)
      .get(`/videos/${draft.public_id}/upload`)
      .set(headers)
      .expect(200)
      .expect('Retry-After', '5')
      .expect(({ body: upload }) =>
        expect(upload).toMatchObject({
          state: 'initiating',
          lastErrorCode: 'STORAGE_UNAVAILABLE',
          uploadedParts: [],
        }),
      );
    const replays = await Promise.all([
      create().expect(200),
      create().expect(200),
    ]);
    for (const replay of replays) {
      expect(replay.body.video).toMatchObject({
        id: draft.id,
        publicId: draft.public_id,
      });
    }
    await request(server)
      .get(`/videos/${draft.public_id}/upload`)
      .set(headers)
      .expect(200)
      .expect(({ body: upload }) => expect(upload.state).toBe('uploading'));
    expect(await harness.multipartUploads(draft.public_id)).toBe(1);
    expect(
      (
        await dataSource.query<{ count: string }[]>(
          'SELECT count(*)::text AS count FROM videos WHERE channel_id=$1',
          [actor.channelId],
        )
      )[0].count,
    ).toBe('1');
  });

  it('adopts the real multipart after the create response is lost', async () => {
    const actor = actors[0];
    const server = harness.app.getHttpServer();
    const headers = { Authorization: `Bearer ${actor.token}` };
    const key = randomUUID();
    const payload = { ...body, title: 'Lost create response', sizeBytes: 1 };
    const createMultipart = harness.storage.createMultipartUpload.bind(
      harness.storage,
    );

    jest
      .spyOn(harness.storage, 'createMultipartUpload')
      .mockImplementationOnce(async (storageKey, contentType) => {
        await createMultipart(storageKey, contentType);
        throw new Error('response lost after multipart creation');
      });

    await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(503);
    jest.restoreAllMocks();

    const [draft] = await dataSource.query<
      {
        id: string;
        public_id: string;
        state: string;
        storage_upload_id: string | null;
      }[]
    >(
      `SELECT v.id,v.public_id,s.state,s.storage_upload_id
       FROM videos v JOIN video_upload_sessions s ON s.video_id=v.id
       WHERE s.idempotency_key=$1 AND s.channel_id=$2`,
      [key, actor.channelId],
    );
    expect(draft).toMatchObject({
      state: 'initiating',
      storage_upload_id: null,
    });
    expect(await harness.multipartUploads(draft.public_id)).toBe(1);

    expect(await harness.reconciler.reconcileInitiating()).toBe(1);

    const recovered = await request(server)
      .post('/videos')
      .set(headers)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);
    expect(recovered.body.video).toMatchObject({
      id: draft.id,
      publicId: draft.public_id,
    });
    expect(recovered.body.upload.state).toBe('uploading');
    expect(await harness.multipartUploads(draft.public_id)).toBe(1);
  });

  it('preserves completed and expired sessions on creation replay beyond TTL', async () => {
    const server = harness.app.getHttpServer();
    const payload = {
      title: 'Video E2E',
      filename: 'video.mp4',
      sizeBytes: 1,
      contentType: 'video/mp4',
    };
    const completed = await harness.createUpload(actors[0]);
    const completedHeaders = { Authorization: `Bearer ${actors[0].token}` };
    const signed = await request(server)
      .post(`/videos/${completed.publicId}/upload/parts`)
      .set(completedHeaders)
      .send({ partNumbers: [1] })
      .expect(200);
    await expect(
      harness.putSignedPart(
        signed.body.parts[0].url as string,
        Buffer.from([1]),
      ),
    ).resolves.toBe(200);
    await request(server)
      .post(`/videos/${completed.publicId}/upload/completion`)
      .set(completedHeaders)
      .expect(202);
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()-interval '1 second'
       WHERE video_id=$1`,
      [completed.id],
    );
    await request(server)
      .post('/videos')
      .set(completedHeaders)
      .set('Idempotency-Key', completed.key)
      .send(payload)
      .expect(200)
      .expect(({ body: replay }) =>
        expect(replay).toMatchObject({
          video: {
            id: completed.id,
            publicId: completed.publicId,
            status: 'processing',
          },
          upload: { state: 'completed' },
        }),
      );
    expect(await harness.outboxCount(completed.id)).toBe(1);

    const expired = await harness.createUpload(actors[1]);
    const expiredHeaders = { Authorization: `Bearer ${actors[1].token}` };
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()-interval '1 second'
       WHERE video_id=$1`,
      [expired.id],
    );
    await harness.runExpirationMaintenance();
    await request(server)
      .post('/videos')
      .set(expiredHeaders)
      .set('Idempotency-Key', expired.key)
      .send(payload)
      .expect(200)
      .expect(({ body: replay }) =>
        expect(replay).toMatchObject({
          video: {
            id: expired.id,
            publicId: expired.publicId,
            status: 'draft',
          },
          upload: { state: 'expired' },
        }),
      );
    const fresh = await harness.createUpload(actors[1]);
    expect(fresh.id).not.toBe(expired.id);
    expect((await harness.uploadRow(expired.publicId)).state).toBe('expired');
  });

  it('rotates a real refresh token and resumes only missing multipart parts', async () => {
    const priorAccessTtl = process.env.JWT_ACCESS_EXPIRATION;
    process.env.JWT_ACCESS_EXPIRATION = '3s';
    let shortHarness: VideoE2eHarness | undefined;
    let shortActor: VideoE2eActor | undefined;
    try {
      shortHarness = await createVideoE2eHarness();
      shortActor = await shortHarness.createActor('password123');
      const server = shortHarness.app.getHttpServer();
      const email = `${shortActor.userId}@video-e2e.test`;
      const login = await request(server)
        .post('/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      const access = login.body.access_token as string;
      const refresh = login.body.refresh_token as string;
      const created = await request(server)
        .post('/videos')
        .set('Authorization', `Bearer ${access}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...body, title: 'Refresh resume' })
        .expect(201);
      const publicId = created.body.video.publicId as string;
      const expiry = (await shortHarness.uploadRow(publicId)).expires_at;
      const sourceKey = (await shortHarness.uploadRow(publicId)).source_key;
      const firstSigned = await request(server)
        .post(`/videos/${publicId}/upload/parts`)
        .set('Authorization', `Bearer ${access}`)
        .send({ partNumbers: [1] })
        .expect(200);
      await expect(
        shortHarness.putSignedPart(
          firstSigned.body.parts[0].url as string,
          Buffer.alloc(67_108_864, 7),
        ),
      ).resolves.toBe(200);
      const firstListing = await request(server)
        .get(`/videos/${publicId}/upload`)
        .set('Authorization', `Bearer ${access}`)
        .expect(200);
      expect(firstListing.body.uploadedParts).toHaveLength(1);
      const firstEtag = firstListing.body.uploadedParts[0].etag as string;

      await new Promise((resolve) => setTimeout(resolve, 3_200));
      await request(server)
        .get(`/videos/${publicId}/upload`)
        .set('Authorization', `Bearer ${access}`)
        .expect(401);
      const rotated = await request(server)
        .post('/auth/refresh')
        .send({ refresh_token: refresh })
        .expect(200);
      expect(rotated.body.refresh_token).not.toBe(refresh);
      const newAccess = rotated.body.access_token as string;
      const claims = shortHarness.app.get(JwtService).decode(newAccess);
      expect(claims.exp - claims.iat).toBe(3);
      const resumed = await request(server)
        .get(`/videos/${publicId}/upload`)
        .set('Authorization', `Bearer ${newAccess}`)
        .expect(200);
      expect(resumed.body.uploadedParts).toMatchObject([
        { partNumber: 1, etag: firstEtag },
      ]);
      const secondSigned = await request(server)
        .post(`/videos/${publicId}/upload/parts`)
        .set('Authorization', `Bearer ${newAccess}`)
        .send({ partNumbers: [2] })
        .expect(200);
      await expect(
        shortHarness.putSignedPart(
          secondSigned.body.parts[0].url as string,
          Buffer.from([8]),
        ),
      ).resolves.toBe(200);
      const finalListing = await request(server)
        .get(`/videos/${publicId}/upload`)
        .set('Authorization', `Bearer ${newAccess}`)
        .expect(200);
      expect(finalListing.body.uploadedParts).toMatchObject([
        { partNumber: 1, etag: firstEtag },
        { partNumber: 2, sizeBytes: 1 },
      ]);
      await request(server)
        .post(`/videos/${publicId}/upload/completion`)
        .set('Authorization', `Bearer ${newAccess}`)
        .expect(202);
      expect((await shortHarness.uploadRow(publicId)).expires_at).toEqual(
        expiry,
      );
      expect((await shortHarness.uploadRow(publicId)).source_key).toBe(
        sourceKey,
      );
      const tokens = await shortHarness.dataSource.query<
        { family: string; revoked_at: Date | null }[]
      >(
        'SELECT family,revoked_at FROM refresh_tokens WHERE user_id=$1 ORDER BY created_at',
        [shortActor.userId],
      );
      expect(tokens).toHaveLength(2);
      expect(tokens[0].family).toBe(tokens[1].family);
      expect(tokens.filter((token) => token.revoked_at === null)).toHaveLength(
        1,
      );
    } finally {
      if (priorAccessTtl === undefined)
        delete process.env.JWT_ACCESS_EXPIRATION;
      else process.env.JWT_ACCESS_EXPIRATION = priorAccessTtl;
      if (shortHarness) {
        if (shortActor) await shortHarness.cleanActors([shortActor]);
        await shortHarness.close();
      }
    }
  });

  it('observes private MinIO storage and origin-specific CORS on signed uploads', async () => {
    const actor = actors[0];
    const upload = await harness.createUpload(actor);
    const { source_key: sourceKey } = await harness.uploadRow(upload.publicId);
    const endpoint = process.env.S3_INTERNAL_ENDPOINT!;
    const bucket = process.env.S3_BUCKET!;
    const objectUrl = `${endpoint}/${bucket}/${sourceKey}`;
    for (const [origin, allowed] of [
      ['http://localhost:3000', true],
      ['https://forbidden.example', false],
    ] as const) {
      const preflight = await fetch(objectUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(
        allowed ? origin : null,
      );
      if (allowed) {
        expect(preflight.headers.get('access-control-allow-methods')).toContain(
          'PUT',
        );
        expect(preflight.headers.get('access-control-allow-headers')).toContain(
          'content-type',
        );
      }
    }
    const signed = await request(harness.app.getHttpServer())
      .post(`/videos/${upload.publicId}/upload/parts`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ partNumbers: [1] })
      .expect(200);
    const target = new URL(signed.body.parts[0].url as string);
    const internal = new URL(endpoint);
    const put = await new Promise<{
      status: number;
      headers: IncomingHttpHeaders;
    }>((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: internal.hostname,
          port: internal.port,
          path: `${target.pathname}${target.search}`,
          method: 'PUT',
          headers: {
            Host: target.host,
            Origin: 'http://localhost:3000',
            'Content-Length': 1,
          },
        },
        (response) => {
          response.resume();
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
            }),
          );
        },
      );
      outgoing.on('error', reject);
      outgoing.end(Buffer.from([1]));
    });
    expect(put.status).toBe(200);
    expect(put.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(put.headers['access-control-expose-headers']).toMatch(/etag/i);
    const anonymous = await fetch(objectUrl);
    expect(anonymous.status).toBe(403);
  });

  it('exports the video OpenAPI contract without dispatching or maintaining uploads', async () => {
    const upload = await harness.createUpload(actors[0]);
    await dataSource.query(
      `UPDATE video_upload_sessions SET expires_at=clock_timestamp()-interval '1 second'
       WHERE video_id=$1`,
      [upload.id],
    );
    const outboxBefore = await harness.outboxCount();
    const queueBefore = await harness.queue.getJobCounts(
      'wait',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    const stateBefore = await harness.uploadRow(upload.publicId);
    const document = buildSwaggerDocument(harness.app);
    const exported = JSON.parse(JSON.stringify(document)) as typeof document;
    expect(exported.paths).toEqual(
      expect.objectContaining({
        '/videos': expect.any(Object),
        '/videos/{publicId}': expect.any(Object),
        '/videos/{publicId}/upload': expect.any(Object),
        '/videos/{publicId}/upload/parts': expect.any(Object),
        '/videos/{publicId}/upload/completion': expect.any(Object),
      }),
    );
    expect(exported.components?.securitySchemes).toMatchObject({
      'access-token': { type: 'http', scheme: 'bearer' },
    });
    expect(exported.components?.securitySchemes).not.toHaveProperty('bearer');
    type ContractOperation = {
      security?: Array<Record<string, string[]>>;
      responses?: Record<
        string,
        { headers?: Record<string, unknown>; content?: Record<string, unknown> }
      >;
    };
    const paths = exported.paths as unknown as Record<
      string,
      Record<string, ContractOperation>
    >;
    const expectedOperations = [
      ['/videos', 'post'],
      ['/videos/{publicId}/upload/parts', 'post'],
      ['/videos/{publicId}/upload', 'get'],
      ['/videos/{publicId}/upload/completion', 'post'],
      ['/videos/{publicId}', 'get'],
      ['/videos/{publicId}/stream', 'head'],
      ['/videos/{publicId}/stream', 'get'],
      ['/videos/{publicId}/download', 'head'],
      ['/videos/{publicId}/download', 'get'],
      ['/videos/{publicId}/thumbnail', 'head'],
      ['/videos/{publicId}/thumbnail', 'get'],
      ['/videos/{publicId}/upload', 'delete'],
    ] as const;
    expect(expectedOperations).toHaveLength(12);
    for (const [path, method] of expectedOperations) {
      const operation = paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation.security).toEqual([{ 'access-token': [] }]);
      for (const requirement of operation.security ?? []) {
        for (const name of Object.keys(requirement))
          expect(exported.components?.securitySchemes).toHaveProperty(name);
      }
      if (method === 'head')
        expect(operation.responses).not.toHaveProperty('200');
    }
    for (const [path, method, status] of [
      ['/videos', 'post', '201'],
      ['/videos', 'post', '200'],
      ['/videos/{publicId}/upload/parts', 'post', '200'],
      ['/videos/{publicId}/upload', 'get', '200'],
      ['/videos/{publicId}/upload/completion', 'post', '202'],
      ['/videos/{publicId}', 'get', '200'],
    ] as const) {
      expect(paths[path][method].responses?.[status]?.content).toHaveProperty(
        'application/json',
      );
    }
    expect(paths['/videos'].post.responses?.['201']?.headers).toHaveProperty(
      'Location',
    );
    expect(
      paths['/videos/{publicId}/upload/completion'].post.responses?.['409']
        ?.headers,
    ).toHaveProperty('Retry-After');
    for (const media of ['stream', 'download', 'thumbnail']) {
      for (const method of ['get', 'head']) {
        const headers =
          paths[`/videos/{publicId}/${media}`][method].responses?.['307']
            ?.headers;
        expect(headers).toHaveProperty('Location');
        expect(headers).toHaveProperty('Cache-Control');
      }
    }
    const schemas = exported.components?.schemas as Record<
      string,
      { properties?: Record<string, { nullable?: boolean }> }
    >;
    for (const property of ['durationMs', 'metadata', 'failureCode'])
      expect(schemas.VideoViewDto.properties?.[property]?.nullable).toBe(true);
    expect(exported.paths['/videos']?.post?.responses).toEqual(
      expect.objectContaining({
        '201': expect.any(Object),
        '400': expect.any(Object),
        '409': expect.any(Object),
        '429': expect.any(Object),
      }),
    );
    expect(await harness.outboxCount()).toBe(outboxBefore);
    expect(
      await harness.queue.getJobCounts(
        'wait',
        'active',
        'completed',
        'failed',
        'delayed',
      ),
    ).toEqual(queueBefore);
    expect((await harness.uploadRow(upload.publicId)).state).toBe(
      stateBefore.state,
    );
    expect(
      (await harness.uploadRow(upload.publicId)).quota_released_at,
    ).toEqual(stateBefore.quota_released_at);
  });
});
