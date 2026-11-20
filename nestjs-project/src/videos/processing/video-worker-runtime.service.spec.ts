import { VideoWorkerRuntimeService } from './video-worker-runtime.service';

describe('VideoWorkerRuntimeService', () => {
  it('waits for an active maintenance cycle before shutdown completes', async () => {
    let releaseDispatch: (() => void) | undefined;
    const dispatchFinished = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const dispatcher = {
      dispatchOnce: jest.fn(async () => dispatchFinished),
    };
    const reconciler = {
      reconcileInitiating: jest.fn(async () => 0),
      reconcileCompleting: jest.fn(async () => 0),
      sweepExpired: jest.fn(async () => 0),
    };
    const service = new VideoWorkerRuntimeService(
      dispatcher as never,
      reconciler as never,
      {
        reconcileOnce: jest.fn(async () => 0),
        cleanAbandonedAttempts: jest.fn(async () => 0),
      } as never,
      { reconcileDue: jest.fn(async () => 0) } as never,
    );

    service.onApplicationBootstrap();
    let shutdownCompleted = false;
    const shutdown = service.beforeApplicationShutdown().then(() => {
      shutdownCompleted = true;
    });
    await Promise.resolve();

    expect(shutdownCompleted).toBe(false);
    releaseDispatch?.();
    await shutdown;
    expect(shutdownCompleted).toBe(true);
  });
});
