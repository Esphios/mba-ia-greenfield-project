import { VideoDeliveryService } from './video-delivery.service';
import { VideoUploadError } from './video-upload.service';
import type { OwnedVideoRow } from './videos.repository';

describe('VideoDeliveryService', () => {
  const ready: OwnedVideoRow = {
    id: 'id',
    public_id: 'public-id',
    title: 'Video',
    original_filename: 'folder/unsafe\r\nname.mp4',
    size_bytes: '100',
    status: 'ready',
    source_key: 'source',
    stream_key: 'stream',
    thumbnail_key: 'thumbnail',
    duration_ms: '1000',
    metadata: null,
    failure_code: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const repository = { findOwnedVideo: jest.fn() };
  const storage = {
    signGet: jest.fn(async () => 'get-url'),
    signHead: jest.fn(async () => 'head-url'),
  };
  const service = new VideoDeliveryService(
    repository as never,
    storage as never,
    { urlTtlSeconds: 900 } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findOwnedVideo.mockResolvedValue(ready);
  });

  it('masks another owner before signing any storage URL', async () => {
    repository.findOwnedVideo.mockResolvedValueOnce(null);
    await expect(
      service.signedLocation('other', 'public-id', 'stream', 'GET'),
    ).rejects.toMatchObject({
      code: 'VIDEO_NOT_FOUND',
    } satisfies Partial<VideoUploadError>);
    expect(storage.signGet).not.toHaveBeenCalled();
  });

  it('blocks draft media without exposing a storage URL', async () => {
    repository.findOwnedVideo.mockResolvedValueOnce({
      ...ready,
      status: 'draft',
    });
    await expect(
      service.signedLocation('owner', 'public-id', 'stream', 'GET'),
    ).rejects.toMatchObject({
      code: 'VIDEO_NOT_READY',
    } satisfies Partial<VideoUploadError>);
    expect(storage.signGet).not.toHaveBeenCalled();
  });

  it('signs the right key and method with a short TTL', async () => {
    await service.signedLocation('owner', 'public-id', 'stream', 'GET');
    expect(storage.signGet).toHaveBeenCalledWith('stream', 900);
    await service.signedLocation('owner', 'public-id', 'thumbnail', 'HEAD');
    expect(storage.signHead).toHaveBeenCalledWith('thumbnail', 900);
    await service.signedLocation('owner', 'public-id', 'download', 'GET');
    expect(storage.signGet).toHaveBeenLastCalledWith(
      'source',
      900,
      expect.stringMatching(/^attachment; filename="[^\r\n/]*"$/),
    );
  });

  it('maps storage signing failure to an unavailable response code', async () => {
    storage.signGet.mockRejectedValueOnce(new Error('storage offline'));
    await expect(
      service.signedLocation('owner', 'public-id', 'stream', 'GET'),
    ).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    } satisfies Partial<VideoUploadError>);
  });
});
