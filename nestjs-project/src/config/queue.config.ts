import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  prefix: process.env.VIDEO_QUEUE_PREFIX ?? 'streamtube',
}));
