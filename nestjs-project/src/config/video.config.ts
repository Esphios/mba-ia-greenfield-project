import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  publicUrl: (process.env.API_PUBLIC_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  ),
  urlTtlSeconds: Number.parseInt(
    process.env.VIDEO_URL_TTL_SECONDS ?? '900',
    10,
  ),
  workerConcurrency: Number.parseInt(
    process.env.VIDEO_WORKER_CONCURRENCY ?? '1',
    10,
  ),
  workDirectory: process.env.VIDEO_WORK_DIR ?? '/work/videos',
}));
