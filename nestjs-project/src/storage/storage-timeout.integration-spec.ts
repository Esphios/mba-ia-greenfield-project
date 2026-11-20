import type { ConfigType } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import storageConfig from '../config/storage.config';
import type { CleanupObligationClaim } from '../videos/cleanup-obligation.repository';
import { CleanupCoordinatorService } from '../videos/cleanup-coordinator.service';
import type { CleanupObligationRepository } from '../videos/cleanup-obligation.repository';
import type { VideoScratchService } from '../videos/video-scratch.service';
import { StorageService } from './storage.service';

describe('bounded storage I/O infrastructure', () => {
  let server: Server;
  let endpoint: string;
  let closedRequests: number;

  beforeEach(async () => {
    closedRequests = 0;
    server = createServer((request) => {
      request.once('close', () => {
        closedRequests += 1;
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  function createStorage(): StorageService {
    return new StorageService({
      backend: 'minio',
      internalEndpoint: endpoint,
      publicEndpoint: endpoint,
      region: 'us-east-1',
      bucket: 'timeout-test-bucket',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      forcePathStyle: true,
      allowedOrigins: [],
      connectTimeoutMs: 50,
      controlTimeoutMs: 100,
      completeTimeoutMs: 150,
    } as ConfigType<typeof storageConfig>);
  }

  async function expectClosedRequests(expected: number): Promise<void> {
    const deadline = Date.now() + 500;
    while (closedRequests < expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(closedRequests).toBe(expected);
  }

  const claim = (
    suffix: string,
    sessionState: CleanupObligationClaim['session_state'],
  ): CleanupObligationClaim => ({
    session_id: `10000000-0000-4000-8000-0000000000${suffix}`,
    state: 'pending',
    attempts: 0,
    lock_token: `20000000-0000-4000-8000-0000000000${suffix}`,
    session_state: sessionState,
    video_id: `30000000-0000-4000-8000-0000000000${suffix}`,
    channel_id: `40000000-0000-4000-8000-0000000000${suffix}`,
    storage_upload_id: null,
    video_status: 'draft',
    source_key: `videos/video-${suffix}/source.mp4`,
    stream_key: null,
    thumbnail_key: null,
  });

  it('destroys hanging requests and lets later maintenance work continue', async () => {
    const storage = createStorage();
    const startedAt = Date.now();
    await expect(storage.headObject('hanging')).rejects.toThrow(
      'STORAGE_OPERATION_TIMEOUT',
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    await expectClosedRequests(1);

    const hanging = claim('01', 'aborted');
    const nextItem = claim('02', 'completed');
    const nextCycle = claim('03', 'completed');
    const repository = {
      claimDue: jest
        .fn()
        .mockResolvedValueOnce([hanging, nextItem])
        .mockResolvedValueOnce([nextCycle]),
      reschedule: jest.fn().mockResolvedValue(true),
      confirmAndReleaseQuota: jest.fn(),
    };
    const scratch = { removeAndVerify: jest.fn() };
    const coordinator = new CleanupCoordinatorService(
      repository as unknown as CleanupObligationRepository,
      storage,
      scratch as unknown as VideoScratchService,
    );

    await expect(coordinator.reconcileDue()).resolves.toBe(0);
    expect(repository.reschedule).toHaveBeenCalledWith(
      hanging.session_id,
      hanging.lock_token,
    );
    expect(repository.reschedule).toHaveBeenCalledWith(
      nextItem.session_id,
      nextItem.lock_token,
    );
    await expectClosedRequests(2);

    await expect(coordinator.reconcileDue()).resolves.toBe(0);
    expect(repository.reschedule).toHaveBeenCalledWith(
      nextCycle.session_id,
      nextCycle.lock_token,
    );
    expect(repository.claimDue).toHaveBeenCalledTimes(2);
  });
});
