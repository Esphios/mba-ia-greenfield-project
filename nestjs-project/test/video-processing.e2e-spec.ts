import { readFile } from 'node:fs/promises';
import request from 'supertest';
import {
  createVideoE2eHarness,
  type VideoE2eActor,
  type VideoE2eHarness,
} from './support/video-upload-e2e-harness';

const run = process.env.VIDEO_WORKER_E2E === '1' ? describe : describe.skip;

run('Video upload through standalone processing worker (e2e)', () => {
  let harness: VideoE2eHarness;
  let actor: VideoE2eActor;

  beforeAll(async () => {
    harness = await createVideoE2eHarness('streamtube_phase03_processing_e2e');
    actor = await harness.createActor();
  });

  afterAll(async () => {
    await harness.cleanActors([actor]);
    await harness.close();
  });

  async function upload(bytes: Buffer): Promise<string> {
    const created = await harness.createUpload(actor, {
      title: 'Worker e2e',
      filename: 'source.mp4',
      sizeBytes: bytes.length,
      contentType: 'video/mp4',
    });
    const server = harness.app.getHttpServer();
    const authorization = `Bearer ${actor.token}`;
    const draft = await request(server)
      .get(`/videos/${created.publicId}`)
      .set('Authorization', authorization)
      .expect(200);
    expect(draft.body.status).toBe('draft');
    const signed = await request(server)
      .post(`/videos/${created.publicId}/upload/parts`)
      .set('Authorization', authorization)
      .send({ partNumbers: [1] })
      .expect(200);
    expect(await harness.putSignedPart(signed.body.parts[0].url, bytes)).toBe(
      200,
    );
    const completed = await request(server)
      .post(`/videos/${created.publicId}/upload/completion`)
      .set('Authorization', authorization)
      .expect(202);
    expect(completed.body.status).toBe('processing');
    return created.publicId;
  }

  async function terminal(publicId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const response = await request(harness.app.getHttpServer())
        .get(`/videos/${publicId}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);
      if (response.body.status === 'ready' || response.body.status === 'error')
        return response.body as Record<string, unknown>;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Processing did not reach terminal state: ${publicId}`);
  }

  it('moves an MP4 from draft through outbox to ready with derivatives', async () => {
    const publicId = await upload(await readFile('test/fixtures/delivery.mp4'));
    const result = await terminal(publicId);
    expect(result).toMatchObject({ status: 'ready', failureCode: null });
    expect(result.durationMs).toEqual(expect.any(Number));
    expect(result.metadata).toMatchObject({
      format: 'mp4',
      videoCodec: 'h264',
    });
    const [row] = await harness.dataSource.query<
      { stream_key: string; thumbnail_key: string }[]
    >('SELECT stream_key,thumbnail_key FROM videos WHERE public_id=$1', [
      publicId,
    ]);
    expect(
      (await harness.storage.headObject(row.stream_key)).ContentLength,
    ).toBeGreaterThan(0);
    expect(
      (await harness.storage.headObject(row.thumbnail_key)).ContentLength,
    ).toBeGreaterThan(0);
  });

  it('moves invalid media to error without publishing delivery URL', async () => {
    const publicId = await upload(Buffer.from('this is not an MP4 video'));
    const result = await terminal(publicId);
    expect(result).toMatchObject({
      status: 'error',
      failureCode: 'INVALID_VIDEO',
    });
    await request(harness.app.getHttpServer())
      .get(`/videos/${publicId}/stream`)
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(409);
  });
});
