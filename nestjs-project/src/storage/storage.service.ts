import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
  type HeadObjectCommandOutput,
  type MultipartUpload,
  type Part,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  PassThrough,
  Readable,
  pipeline as pipelineCallback,
} from 'node:stream';
import { pipeline } from 'node:stream/promises';
import storageConfig from '../config/storage.config';
import { LimitedByteStream } from './limited-byte-stream';
import { VIDEO_PART_BYTES } from '../common/video-limits';

export class StorageOperationTimeoutError extends Error {
  readonly code = 'STORAGE_OPERATION_TIMEOUT';

  constructor() {
    super('STORAGE_OPERATION_TIMEOUT');
    this.name = 'StorageOperationTimeoutError';
  }
}

@Injectable()
export class StorageService {
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    const shared = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.internalClient = new S3Client({
      ...shared,
      endpoint: config.internalEndpoint,
      requestHandler: {
        connectionTimeout: config.connectTimeoutMs,
        requestTimeout: config.completeTimeoutMs,
        throwOnRequestTimeout: true,
      },
    });
    this.publicClient = new S3Client({
      ...shared,
      endpoint: config.publicEndpoint,
    });
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.withDeadline(
      this.config.controlTimeoutMs,
      signal,
      (abortSignal) =>
        this.internalClient.send(
          new CreateMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: key,
            ContentType: contentType,
          }),
          { abortSignal },
        ),
    );
    if (!response.UploadId)
      throw new Error('Storage did not return an upload id');
    return response.UploadId;
  }

  async signUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    contentLength: number,
    expiresIn: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        ContentLength: contentLength,
      }),
      { expiresIn },
    );
  }

  listParts(
    key: string,
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<Part[]> {
    return this.withDeadline(
      this.config.controlTimeoutMs,
      signal,
      async (abortSignal) => {
        const parts: Part[] = [];
        let marker: string | undefined;
        do {
          const page = await this.internalClient.send(
            new ListPartsCommand({
              Bucket: this.config.bucket,
              Key: key,
              UploadId: uploadId,
              PartNumberMarker: marker,
            }),
            { abortSignal },
          );
          parts.push(...(page.Parts ?? []));
          marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
        } while (marker !== undefined);
        return parts;
      },
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
    signal?: AbortSignal,
  ): Promise<void> {
    await this.withDeadline(
      this.config.completeTimeoutMs,
      signal,
      (abortSignal) =>
        this.internalClient.send(
          new CompleteMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
          }),
          { abortSignal },
        ),
    );
  }

  async abortMultipartUpload(
    key: string,
    uploadId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.withDeadline(
      this.config.controlTimeoutMs,
      signal,
      (abortSignal) =>
        this.internalClient.send(
          new AbortMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId,
          }),
          { abortSignal },
        ),
    );
  }

  listMultipartUploads(
    prefix: string,
    signal?: AbortSignal,
  ): Promise<MultipartUpload[]> {
    return this.withDeadline(
      this.config.controlTimeoutMs,
      signal,
      async (abortSignal) => {
        const uploads: MultipartUpload[] = [];
        let keyMarker: string | undefined;
        let uploadIdMarker: string | undefined;
        do {
          const page = await this.internalClient.send(
            new ListMultipartUploadsCommand({
              Bucket: this.config.bucket,
              Prefix: prefix,
              KeyMarker: keyMarker,
              UploadIdMarker: uploadIdMarker,
            }),
            { abortSignal },
          );
          uploads.push(...(page.Uploads ?? []));
          keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
          uploadIdMarker = page.IsTruncated
            ? page.NextUploadIdMarker
            : undefined;
        } while (keyMarker !== undefined || uploadIdMarker !== undefined);
        return uploads;
      },
    );
  }

  async headObject(
    key: string,
    signal?: AbortSignal,
  ): Promise<HeadObjectCommandOutput> {
    return this.withDeadline(
      this.config.controlTimeoutMs,
      signal,
      (abortSignal) =>
        this.internalClient.send(
          new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
          { abortSignal },
        ),
    );
  }

  async deleteObject(key: string, signal?: AbortSignal): Promise<void> {
    await this.withDeadline(
      this.config.controlTimeoutMs,
      signal,
      (abortSignal) =>
        this.internalClient.send(
          new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
          { abortSignal },
        ),
    );
  }

  listObjectKeys(prefix: string, signal?: AbortSignal): Promise<string[]> {
    return this.withDeadline(
      this.config.controlTimeoutMs,
      signal,
      async (abortSignal) => {
        const keys: string[] = [];
        let token: string | undefined;
        do {
          const page = await this.internalClient.send(
            new ListObjectsV2Command({
              Bucket: this.config.bucket,
              Prefix: prefix,
              ContinuationToken: token,
            }),
            { abortSignal },
          );
          keys.push(
            ...(page.Contents ?? []).flatMap((object) =>
              object.Key ? [object.Key] : [],
            ),
          );
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
        return keys;
      },
    );
  }

  async downloadStream(
    key: string,
    maximumBytes: number,
    signal?: AbortSignal,
  ): Promise<Readable> {
    const response = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { abortSignal: signal },
    );
    if (!(response.Body instanceof Readable)) {
      throw new Error('Storage response body is not a Node stream');
    }
    const limitedBody = new LimitedByteStream(maximumBytes);
    pipelineCallback(response.Body, limitedBody, (error) => {
      if (error && !limitedBody.destroyed) limitedBody.destroy(error);
    });
    return limitedBody;
  }

  async uploadStream(
    key: string,
    body: Readable,
    contentType: string,
    maximumBytes: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const limitedBody = new LimitedByteStream(maximumBytes);
    const uploadBody = new PassThrough();
    const transfer = pipeline(body, limitedBody, uploadBody, { signal });
    const uploadController = new AbortController();
    const abortUpload = () => uploadController.abort(signal?.reason);
    signal?.addEventListener('abort', abortUpload, { once: true });
    const upload = new Upload({
      client: this.internalClient,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: uploadBody,
        ContentType: contentType,
      },
      partSize: VIDEO_PART_BYTES,
      queueSize: 2,
      leavePartsOnError: false,
      abortController: uploadController,
    });
    const completion = upload.done();
    try {
      await Promise.all([transfer, completion]);
    } catch (error: unknown) {
      const streamError = error instanceof Error ? error : undefined;
      body.destroy(streamError);
      limitedBody.destroy(streamError);
      uploadBody.destroy(streamError);
      await Promise.allSettled([transfer, completion, upload.abort()]);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abortUpload);
    }
  }

  signGet(
    key: string,
    expiresIn: number,
    disposition?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn },
    );
  }

  signHead(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn },
    );
  }

  private async withDeadline<T>(
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abortFromCaller();
    else
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new StorageOperationTimeoutError()),
      timeoutMs,
    );
    timeout.unref();
    try {
      return await operation(controller.signal);
    } catch (error: unknown) {
      if (controller.signal.reason instanceof StorageOperationTimeoutError) {
        throw controller.signal.reason;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
