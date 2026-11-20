import { CleanupCoordinatorService } from './cleanup-coordinator.service';
import {
  CleanupObligationClaim,
  CleanupObligationRepository,
} from './cleanup-obligation.repository';
import { StorageService } from '../storage/storage.service';
import { VideoScratchService } from './video-scratch.service';

describe('CleanupCoordinatorService', () => {
  const repository = {
    claimDue: jest.fn(),
    confirmAndReleaseQuota: jest.fn(),
    reschedule: jest.fn(),
  };
  const storage = {
    listMultipartUploads: jest.fn(),
    abortMultipartUpload: jest.fn(),
    listObjectKeys: jest.fn(),
    deleteObject: jest.fn(),
    headObject: jest.fn(),
  };
  const scratch = { removeAndVerify: jest.fn() };
  let service: CleanupCoordinatorService;

  const claim = (
    overrides: Partial<CleanupObligationClaim> = {},
  ): CleanupObligationClaim => ({
    session_id: '10000000-0000-4000-8000-000000000001',
    state: 'pending',
    attempts: 0,
    lock_token: '10000000-0000-4000-8000-000000000002',
    session_state: 'completed',
    video_id: '10000000-0000-4000-8000-000000000003',
    channel_id: '10000000-0000-4000-8000-000000000004',
    storage_upload_id: null,
    video_status: 'ready',
    source_key: 'videos/10000000-0000-4000-8000-000000000003/source.mp4',
    stream_key: 'videos/10000000-0000-4000-8000-000000000003/stream.mp4',
    thumbnail_key: 'videos/10000000-0000-4000-8000-000000000003/thumbnail.jpg',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    storage.listMultipartUploads.mockResolvedValue([]);
    storage.listObjectKeys.mockResolvedValue([]);
    storage.abortMultipartUpload.mockResolvedValue(undefined);
    storage.deleteObject.mockResolvedValue(undefined);
    storage.headObject.mockRejectedValue({
      $metadata: { httpStatusCode: 404 },
    });
    scratch.removeAndVerify.mockResolvedValue(undefined);
    repository.confirmAndReleaseQuota.mockResolvedValue(true);
    repository.reschedule.mockResolvedValue(true);
    service = new CleanupCoordinatorService(
      repository as unknown as CleanupObligationRepository,
      storage as unknown as StorageService,
      scratch as unknown as VideoScratchService,
    );
  });

  it.each(['aborted', 'expired'] as const)(
    'removes every object and multipart for %s sessions',
    async (sessionState) => {
      const current = claim({ session_state: sessionState });
      repository.claimDue.mockResolvedValue([current]);
      storage.listMultipartUploads
        .mockResolvedValueOnce([
          { Key: current.source_key, UploadId: 'stale-upload' },
        ])
        .mockResolvedValueOnce([]);
      storage.listObjectKeys
        .mockResolvedValueOnce([current.source_key, current.stream_key])
        .mockResolvedValueOnce([]);

      await expect(service.reconcileDue()).resolves.toBe(1);

      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        current.source_key,
        'stale-upload',
      );
      expect(storage.deleteObject).toHaveBeenCalledWith(current.source_key);
      expect(storage.deleteObject).toHaveBeenCalledWith(current.stream_key);
      expect(scratch.removeAndVerify).toHaveBeenCalledWith(current.video_id);
      expect(repository.confirmAndReleaseQuota).toHaveBeenCalledWith(
        current.session_id,
        current.lock_token,
        current,
      );
    },
  );

  it('preserves source and winning derivatives for a ready video', async () => {
    const current = claim();
    const loser = `videos/${current.video_id}/attempts/old/stream.mp4`;
    repository.claimDue.mockResolvedValue([current]);
    storage.listObjectKeys
      .mockResolvedValueOnce([
        current.source_key,
        current.stream_key,
        current.thumbnail_key,
        loser,
      ])
      .mockResolvedValueOnce([
        current.source_key,
        current.stream_key,
        current.thumbnail_key,
      ]);

    await expect(service.reconcileDue()).resolves.toBe(1);

    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(loser);
  });

  it('preserves only the source for a completed error video', async () => {
    const current = claim({ video_status: 'error' });
    repository.claimDue.mockResolvedValue([current]);
    storage.listObjectKeys
      .mockResolvedValueOnce([
        current.source_key,
        current.stream_key,
        current.thumbnail_key,
      ])
      .mockResolvedValueOnce([current.source_key]);

    await expect(service.reconcileDue()).resolves.toBe(1);

    expect(storage.deleteObject).not.toHaveBeenCalledWith(current.source_key);
    expect(storage.deleteObject).toHaveBeenCalledWith(current.stream_key);
    expect(storage.deleteObject).toHaveBeenCalledWith(current.thumbnail_key);
  });

  it.each(['draft', 'processing'] as const)(
    'defers completed + %s without storage or quota mutation',
    async (videoStatus) => {
      const current = claim({ video_status: videoStatus });
      repository.claimDue.mockResolvedValue([current]);

      await expect(service.reconcileDue()).resolves.toBe(0);

      expect(repository.reschedule).toHaveBeenCalledWith(
        current.session_id,
        current.lock_token,
      );
      expect(storage.listObjectKeys).not.toHaveBeenCalled();
      expect(repository.confirmAndReleaseQuota).not.toHaveBeenCalled();
    },
  );

  it('reschedules a failed item and continues with the next claim', async () => {
    const failed = claim();
    const next = claim({
      session_id: '20000000-0000-4000-8000-000000000001',
      lock_token: '20000000-0000-4000-8000-000000000002',
      video_id: '20000000-0000-4000-8000-000000000003',
      source_key: 'videos/20000000-0000-4000-8000-000000000003/source.mp4',
      stream_key: 'videos/20000000-0000-4000-8000-000000000003/stream.mp4',
      thumbnail_key:
        'videos/20000000-0000-4000-8000-000000000003/thumbnail.jpg',
    });
    repository.claimDue.mockResolvedValue([failed, next]);
    storage.listMultipartUploads
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue([]);

    await expect(service.reconcileDue()).resolves.toBe(1);

    expect(repository.reschedule).toHaveBeenCalledWith(
      failed.session_id,
      failed.lock_token,
    );
    expect(repository.confirmAndReleaseQuota).toHaveBeenCalledWith(
      next.session_id,
      next.lock_token,
      next,
    );
  });

  it.each(['list', 'abort', 'delete', 'head', 'rm'] as const)(
    'keeps quota pending when %s verification fails',
    async (stage) => {
      const current = claim({ session_state: 'aborted' });
      repository.claimDue.mockResolvedValue([current]);
      storage.listObjectKeys
        .mockResolvedValueOnce([current.source_key])
        .mockResolvedValueOnce([]);
      if (stage === 'list')
        storage.listMultipartUploads.mockRejectedValueOnce(new Error('list'));
      if (stage === 'abort') {
        storage.listMultipartUploads.mockResolvedValueOnce([
          { Key: current.source_key, UploadId: 'stale' },
        ]);
        storage.abortMultipartUpload.mockRejectedValueOnce(new Error('abort'));
      }
      if (stage === 'delete')
        storage.deleteObject.mockRejectedValueOnce(new Error('delete'));
      if (stage === 'head')
        storage.headObject.mockRejectedValueOnce(new Error('head'));
      if (stage === 'rm')
        scratch.removeAndVerify.mockRejectedValueOnce(new Error('rm'));

      await expect(service.reconcileDue()).resolves.toBe(0);

      expect(repository.reschedule).toHaveBeenCalledWith(
        current.session_id,
        current.lock_token,
      );
      expect(repository.confirmAndReleaseQuota).not.toHaveBeenCalled();
    },
  );
});
