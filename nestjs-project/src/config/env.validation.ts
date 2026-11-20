import * as Joi from 'joi';
import {
  VIDEO_UPLOAD_TTL_SECONDS,
  VIDEO_URL_TTL_MAX_SECONDS,
} from '../common/video-limits';
import {
  STORAGE_COMPLETE_TIMEOUT_MS,
  STORAGE_CONNECT_TIMEOUT_MS,
  STORAGE_CONTROL_TIMEOUT_MS,
  STORAGE_TIMEOUT_MAX_MS,
  STORAGE_TIMEOUT_MIN_MS,
} from '../common/storage-limits';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  API_PUBLIC_URL: Joi.string().uri().default('http://localhost:3000'),
  S3_BACKEND: Joi.string().valid('minio', 'aws').default('minio'),
  S3_INTERNAL_ENDPOINT: Joi.string().uri().default('http://minio:9000'),
  S3_PUBLIC_ENDPOINT: Joi.string().uri().default('http://localhost:9000'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string()
    .min(3)
    .max(63)
    .when('NODE_ENV', {
      is: 'test',
      then: Joi.invalid('streamtube-videos'),
    })
    .default('streamtube-videos'),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  S3_ALLOWED_ORIGINS: Joi.string()
    .custom((value: string, helpers) => {
      const origins = value.split(',').map((origin) => origin.trim());
      if (origins.some((origin) => origin === '*' || origin.length === 0)) {
        return helpers.error('any.invalid');
      }
      if (origins.some((origin) => !URL.canParse(origin))) {
        return helpers.error('string.uri');
      }
      return value;
    })
    .default('http://localhost:3000'),
  S3_CONNECT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(STORAGE_TIMEOUT_MIN_MS)
    .max(STORAGE_TIMEOUT_MAX_MS)
    .default(STORAGE_CONNECT_TIMEOUT_MS),
  S3_CONTROL_TIMEOUT_MS: Joi.number()
    .integer()
    .min(STORAGE_TIMEOUT_MIN_MS)
    .max(STORAGE_TIMEOUT_MAX_MS)
    .default(STORAGE_CONTROL_TIMEOUT_MS),
  S3_COMPLETE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(STORAGE_TIMEOUT_MIN_MS)
    .max(STORAGE_TIMEOUT_MAX_MS)
    .default(STORAGE_COMPLETE_TIMEOUT_MS),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  VIDEO_QUEUE_PREFIX: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .when('NODE_ENV', { is: 'test', then: Joi.invalid('streamtube') })
    .default('streamtube'),
  VIDEO_UPLOAD_TTL_SECONDS: Joi.number()
    .integer()
    .valid(VIDEO_UPLOAD_TTL_SECONDS)
    .default(VIDEO_UPLOAD_TTL_SECONDS),
  VIDEO_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(VIDEO_URL_TTL_MAX_SECONDS)
    .default(VIDEO_URL_TTL_MAX_SECONDS),
  VIDEO_WORKER_CONCURRENCY: Joi.number().integer().valid(1).default(1),
  VIDEO_WORK_DIR: Joi.string().default('/work/videos'),
});
