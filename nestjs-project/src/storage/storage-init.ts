import {
  CreateBucketCommand,
  GetBucketLocationCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { safeErrorContext } from '../common/logging/safe-log-context';

function requireEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { $metadata?: { httpStatusCode?: number } };
  return candidate.$metadata?.httpStatusCode === 404;
}

function permitsAnonymousRead(policy: string): boolean {
  const document = JSON.parse(policy) as {
    Statement?: Array<{
      Effect?: string;
      Principal?: unknown;
      Action?: string | string[];
      Condition?: unknown;
    }>;
  };
  const containsWildcard = (value: unknown): boolean =>
    value === '*' ||
    (Array.isArray(value) && value.some(containsWildcard)) ||
    (typeof value === 'object' &&
      value !== null &&
      Object.values(value).some(containsWildcard));
  const includesObjectRead = (action: unknown): boolean => {
    if (typeof action !== 'string') return false;
    const pattern = action
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replaceAll('*', '.*');
    return new RegExp(`^${pattern}$`, 'i').test('s3:GetObject');
  };
  return (document.Statement ?? []).some((statement) => {
    const actions = Array.isArray(statement.Action)
      ? statement.Action
      : [statement.Action];
    const publicPrincipal = containsWildcard(statement.Principal);
    return (
      statement.Effect === 'Allow' &&
      publicPrincipal &&
      statement.Condition === undefined &&
      actions.some(includesObjectRead)
    );
  });
}

export async function ensureBucket(): Promise<void> {
  const bucket = requireEnvironment('S3_BUCKET');
  const backend = process.env.S3_BACKEND ?? 'minio';
  const region = requireEnvironment('S3_REGION');
  const client = new S3Client({
    endpoint: requireEnvironment('S3_INTERNAL_ENDPOINT'),
    region,
    forcePathStyle: backend === 'minio',
    credentials: {
      accessKeyId: requireEnvironment('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnvironment('S3_SECRET_ACCESS_KEY'),
    },
  });

  let bucketExists = true;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      throw error;
    }
    bucketExists = false;
  }

  if (!bucketExists) {
    try {
      await client.send(
        new CreateBucketCommand({
          Bucket: bucket,
          ...(backend === 'aws' && region !== 'us-east-1'
            ? {
                CreateBucketConfiguration: {
                  LocationConstraint: region as BucketLocationConstraint,
                },
              }
            : {}),
        }),
      );
    } catch {
      // A concurrent bootstrap may have created the bucket after HEAD.
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    }
  }

  try {
    const policy = await client.send(
      new GetBucketPolicyCommand({ Bucket: bucket }),
    );
    if (policy.Policy && permitsAnonymousRead(policy.Policy)) {
      throw new Error('Storage bucket policy permits anonymous object reads');
    }
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }

  if (backend === 'aws') {
    const location = await client.send(
      new GetBucketLocationCommand({ Bucket: bucket }),
    );
    const actualRegion = location.LocationConstraint ?? 'us-east-1';
    if (actualRegion !== region)
      throw new Error('Storage bucket region does not match S3_REGION');
    const origins = requireEnvironment('S3_ALLOWED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim());
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
              AllowedMethods: ['PUT', 'GET', 'HEAD'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  }

  console.log(`Storage bucket ready: ${bucket}`);
}

if (require.main === module)
  void ensureBucket().catch((error: unknown) => {
    console.error('Storage initialization failed', safeErrorContext(error));
    process.exitCode = 1;
  });
