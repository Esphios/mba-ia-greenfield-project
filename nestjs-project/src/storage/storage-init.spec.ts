const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

import { ensureBucket } from './storage-init';

describe('storage bootstrap contracts', () => {
  beforeEach(() => {
    mockSend.mockReset();
    Object.assign(process.env, {
      S3_BUCKET: 'private-test-bucket',
      S3_INTERNAL_ENDPOINT: 'http://storage.test',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'access',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_ALLOWED_ORIGINS: 'http://localhost:3000',
      S3_BACKEND: 'minio',
    });
  });

  it('revalidates an existing MinIO bucket without PutBucketCors', async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });

    await expect(ensureBucket()).resolves.toBeUndefined();
    expect(
      mockSend.mock.calls.map(([command]) => command.constructor.name),
    ).toEqual(['HeadBucketCommand', 'GetBucketPolicyCommand']);
  });

  it.each(['s3:GetObject', 's3:Get*', 's3:*', '*'])(
    'fails safely when public action %s includes anonymous object reads',
    async (action) => {
      mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({
        Policy: JSON.stringify({
          Statement: [{ Effect: 'Allow', Principal: '*', Action: action }],
        }),
      });

      await expect(ensureBucket()).rejects.toThrow('anonymous object reads');
    },
  );

  it('accepts private and conditionally public read policies', async () => {
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({
      Policy: JSON.stringify({
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: 'arn:aws:iam::123456789012:role/private' },
            Action: 's3:GetObject',
          },
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Condition: { StringEquals: { 'aws:SourceVpce': 'vpce-test' } },
          },
        ],
      }),
    });

    await expect(ensureBucket()).resolves.toBeUndefined();
  });

  it('verifies AWS region and applies bucket CORS only for AWS', async () => {
    process.env.S3_BACKEND = 'aws';
    mockSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({ LocationConstraint: undefined })
      .mockResolvedValueOnce({});

    await expect(ensureBucket()).resolves.toBeUndefined();
    expect(
      mockSend.mock.calls.map(([command]) => command.constructor.name),
    ).toEqual([
      'HeadBucketCommand',
      'GetBucketPolicyCommand',
      'GetBucketLocationCommand',
      'PutBucketCorsCommand',
    ]);
  });
});
