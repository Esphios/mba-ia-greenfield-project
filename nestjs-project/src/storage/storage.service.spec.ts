import type { ConfigType } from '@nestjs/config';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  const configuration = {
    backend: 'minio',
    internalEndpoint: 'http://storage.test',
    publicEndpoint: 'http://storage.test',
    region: 'us-east-1',
    bucket: 'test',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    forcePathStyle: true,
    allowedOrigins: [],
    connectTimeoutMs: 5_000,
    controlTimeoutMs: 30_000,
    completeTimeoutMs: 120_000,
  } as ConfigType<typeof storageConfig>;

  afterEach(() => jest.restoreAllMocks());

  it('follows every multipart-upload page marker', async () => {
    const storage = new StorageService(configuration);
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Uploads: [{ Key: 'videos/key', UploadId: 'first' }],
        IsTruncated: true,
        NextKeyMarker: 'videos/key',
        NextUploadIdMarker: 'first',
      })
      .mockResolvedValueOnce({
        Uploads: [{ Key: 'videos/key', UploadId: 'second' }],
        IsTruncated: false,
      });
    (
      storage as unknown as {
        internalClient: { send: typeof send };
      }
    ).internalClient = { send };

    await expect(storage.listMultipartUploads('videos/key')).resolves.toEqual([
      { Key: 'videos/key', UploadId: 'first' },
      { Key: 'videos/key', UploadId: 'second' },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input).toMatchObject({
      KeyMarker: 'videos/key',
      UploadIdMarker: 'first',
    });
    expect(send.mock.calls[0][1].abortSignal).toBe(
      send.mock.calls[1][1].abortSignal,
    );
  });

  it('propagates a download source failure through the bounded stream', async () => {
    const storage = new StorageService(configuration);
    const source = new Readable({ read() {} });
    const send = jest.fn().mockResolvedValue({ Body: source });
    (
      storage as unknown as { internalClient: { send: typeof send } }
    ).internalClient = { send };

    const output = await storage.downloadStream('source', 8);
    const consumed = (async () => {
      for await (const _chunk of output) void _chunk;
    })();
    source.destroy(new Error('origin failed'));

    await expect(consumed).rejects.toThrow('origin failed');
    expect(source.destroyed).toBe(true);
    expect(output.destroyed).toBe(true);
  });

  it('uses a 64MiB two-part window and tears down input when upload fails', async () => {
    const storage = new StorageService(configuration);
    const source = Readable.from(Buffer.from('stream'));
    let options:
      | { partSize: number; queueSize: number; leavePartsOnError: boolean }
      | undefined;
    jest.spyOn(Upload.prototype, 'done').mockImplementation(function () {
      options = this as unknown as typeof options;
      return Promise.reject(new Error('destination failed'));
    });
    const abort = jest.spyOn(Upload.prototype, 'abort').mockResolvedValue();

    await expect(
      storage.uploadStream('target', source, 'video/mp4', 8),
    ).rejects.toThrow('destination failed');
    expect(options).toMatchObject({
      partSize: 67_108_864,
      queueSize: 2,
      leavePartsOnError: false,
    });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(source.destroyed).toBe(true);
  });

  it('propagates caller cancellation to upload, download and HEAD requests', async () => {
    const storage = new StorageService(configuration);
    const uploadCancellation = new AbortController();
    jest.spyOn(Upload.prototype, 'done').mockImplementation(function () {
      const controller = (
        this as unknown as { abortController: AbortController }
      ).abortController;
      return new Promise((_resolve, reject) =>
        controller.signal.addEventListener(
          'abort',
          () =>
            reject(
              controller.signal.reason instanceof Error
                ? controller.signal.reason
                : new Error('aborted'),
            ),
          { once: true },
        ),
      );
    });
    jest.spyOn(Upload.prototype, 'abort').mockResolvedValue();
    const uploading = storage.uploadStream(
      'target',
      Readable.from(Buffer.from('stream')),
      'video/mp4',
      8,
      uploadCancellation.signal,
    );
    uploadCancellation.abort(new Error('caller cancelled'));
    await expect(uploading).rejects.toThrow('caller cancelled');

    const requestCancellation = new AbortController();
    const send = jest.fn().mockRejectedValue(new Error('request cancelled'));
    (
      storage as unknown as { internalClient: { send: typeof send } }
    ).internalClient = { send };
    await expect(
      storage.headObject('target', requestCancellation.signal),
    ).rejects.toThrow('request cancelled');
    await expect(
      storage.downloadStream('target', 8, requestCancellation.signal),
    ).rejects.toThrow('request cancelled');
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
    expect(send.mock.calls[1][1]).toEqual({
      abortSignal: requestCancellation.signal,
    });
  });

  it('forwards a bounded signal to every control operation', async () => {
    const storage = new StorageService(configuration);
    const send = jest.fn<
      Promise<Record<string, unknown>>,
      [unknown, { abortSignal: AbortSignal }]
    >(async (command) =>
      (command as { constructor: { name: string } }).constructor.name ===
      'CreateMultipartUploadCommand'
        ? { UploadId: 'upload-id' }
        : {},
    );
    (
      storage as unknown as { internalClient: { send: typeof send } }
    ).internalClient = { send };

    await storage.createMultipartUpload('key', 'video/mp4');
    await storage.listMultipartUploads('key');
    await storage.listParts('key', 'upload-id');
    await storage.completeMultipartUpload('key', 'upload-id', []);
    await storage.abortMultipartUpload('key', 'upload-id');
    await storage.deleteObject('key');
    await storage.headObject('key');
    await storage.listObjectKeys('key');

    expect(send).toHaveBeenCalledTimes(8);
    for (const [, options] of send.mock.calls) {
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(options.abortSignal.aborted).toBe(false);
    }
  });

  it('cancels a pending control request at its operation deadline', async () => {
    const storage = new StorageService({
      ...configuration,
      controlTimeoutMs: 20,
    });
    const send = jest.fn(
      (_command: unknown, options: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options.abortSignal.addEventListener(
            'abort',
            () =>
              reject(
                options.abortSignal.reason instanceof Error
                  ? options.abortSignal.reason
                  : new Error('request aborted'),
              ),
            { once: true },
          ),
        ),
    );
    (
      storage as unknown as { internalClient: { send: typeof send } }
    ).internalClient = { send };

    await expect(storage.headObject('key')).rejects.toThrow(
      'STORAGE_OPERATION_TIMEOUT',
    );
    expect(send.mock.calls[0][1].abortSignal.aborted).toBe(true);
  });
});
