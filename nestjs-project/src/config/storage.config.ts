import { registerAs } from '@nestjs/config';
import {
  STORAGE_COMPLETE_TIMEOUT_MS,
  STORAGE_CONNECT_TIMEOUT_MS,
  STORAGE_CONTROL_TIMEOUT_MS,
} from '../common/storage-limits';

export default registerAs('storage', () => ({
  backend: process.env.S3_BACKEND ?? 'minio',
  internalEndpoint: process.env.S3_INTERNAL_ENDPOINT ?? 'http://minio:9000',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'streamtube-videos',
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  allowedOrigins: (process.env.S3_ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  connectTimeoutMs: Number(
    process.env.S3_CONNECT_TIMEOUT_MS ?? STORAGE_CONNECT_TIMEOUT_MS,
  ),
  controlTimeoutMs: Number(
    process.env.S3_CONTROL_TIMEOUT_MS ?? STORAGE_CONTROL_TIMEOUT_MS,
  ),
  completeTimeoutMs: Number(
    process.env.S3_COMPLETE_TIMEOUT_MS ?? STORAGE_COMPLETE_TIMEOUT_MS,
  ),
}));
