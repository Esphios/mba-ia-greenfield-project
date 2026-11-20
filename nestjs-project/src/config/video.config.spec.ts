import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from './queue.config';
import storageConfig from './storage.config';
import videoConfig from './video.config';
import { envValidationSchema } from './env.validation';

const requiredEnvironment = {
  DB_USERNAME: 'test-user',
  DB_PASSWORD: 'test-password',
  DB_NAME: 'streamtube_phase03_test',
  JWT_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
};

function validate(environment: Record<string, string> = {}) {
  return envValidationSchema.validate(
    { ...requiredEnvironment, ...environment },
    { allowUnknown: true, abortEarly: false },
  );
}

describe('video infrastructure configuration', () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('loads separate storage, queue and video namespaces', async () => {
    process.env = {
      ...originalEnvironment,
      S3_ACCESS_KEY_ID: 'access-key',
      S3_SECRET_ACCESS_KEY: 'secret-key',
      S3_INTERNAL_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_ALLOWED_ORIGINS: 'http://localhost:3000,http://localhost:4173',
      VIDEO_QUEUE_PREFIX: 'streamtube_phase03_test',
      VIDEO_URL_TTL_SECONDS: '900',
    };

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [storageConfig, queueConfig, videoConfig],
        }),
      ],
    }).compile();

    const storage = module.get<ConfigType<typeof storageConfig>>(
      storageConfig.KEY,
    );
    const queue = module.get<ConfigType<typeof queueConfig>>(queueConfig.KEY);
    const video = module.get<ConfigType<typeof videoConfig>>(videoConfig.KEY);

    expect(storage.internalEndpoint).toBe('http://minio:9000');
    expect(storage.publicEndpoint).toBe('http://localhost:9000');
    expect(storage.allowedOrigins).toEqual([
      'http://localhost:3000',
      'http://localhost:4173',
    ]);
    expect(storage).toMatchObject({
      connectTimeoutMs: 5_000,
      controlTimeoutMs: 30_000,
      completeTimeoutMs: 120_000,
    });
    expect(queue.prefix).toBe('streamtube_phase03_test');
    expect(video).toMatchObject({
      urlTtlSeconds: 900,
      workerConcurrency: 1,
    });
  });

  it('requires storage credentials without exposing their values', () => {
    const { error } = envValidationSchema.validate(
      {
        ...requiredEnvironment,
        S3_ACCESS_KEY_ID: undefined,
        S3_SECRET_ACCESS_KEY: undefined,
      },
      { allowUnknown: true, abortEarly: false },
    );

    expect(error?.message).toContain('S3_ACCESS_KEY_ID');
    expect(error?.message).toContain('S3_SECRET_ACCESS_KEY');
    expect(error?.message).not.toContain('test-secret-key');
  });

  it('rejects a wildcard storage origin', () => {
    const { error } = validate({ S3_ALLOWED_ORIGINS: '*' });
    expect(error?.message).toContain('S3_ALLOWED_ORIGINS');
  });

  it.each(['86399', '86401'])(
    'rejects upload TTL %s because sessions are fixed at one day',
    (value) => {
      const { error } = validate({ VIDEO_UPLOAD_TTL_SECONDS: value });
      expect(error?.message).toContain('VIDEO_UPLOAD_TTL_SECONDS');
    },
  );

  it.each(['0', '901'])('rejects signed URL TTL %s outside 1..900', (value) => {
    const { error } = validate({ VIDEO_URL_TTL_SECONDS: value });
    expect(error?.message).toContain('VIDEO_URL_TTL_SECONDS');
  });

  it.each(['1', '900'])('accepts signed URL TTL boundary %s', (value) => {
    const { error } = validate({
      VIDEO_UPLOAD_TTL_SECONDS: '86400',
      VIDEO_URL_TTL_SECONDS: value,
    });
    expect(error).toBeUndefined();
  });

  it.each([
    'S3_CONNECT_TIMEOUT_MS',
    'S3_CONTROL_TIMEOUT_MS',
    'S3_COMPLETE_TIMEOUT_MS',
  ])('rejects zero and non-finite boundaries for %s', (name) => {
    for (const value of ['0', '999', '300001', 'Infinity']) {
      const { error } = validate({ [name]: value });
      expect(error?.message).toContain(name);
    }
  });

  it.each(['1000', '300000'])(
    'accepts storage timeout boundary %s ms',
    (value) => {
      const { error } = validate({
        S3_CONNECT_TIMEOUT_MS: value,
        S3_CONTROL_TIMEOUT_MS: value,
        S3_COMPLETE_TIMEOUT_MS: value,
      });
      expect(error).toBeUndefined();
    },
  );

  it('accepts isolated test bucket and queue prefix', () => {
    const { value, error } = validate({
      NODE_ENV: 'test',
      S3_BUCKET: 'streamtube-phase03-test',
      VIDEO_QUEUE_PREFIX: 'streamtube_phase03_test',
    });

    expect(error).toBeUndefined();
    expect(value.S3_BUCKET).toBe('streamtube-phase03-test');
    expect(value.VIDEO_QUEUE_PREFIX).toBe('streamtube_phase03_test');
  });
});
