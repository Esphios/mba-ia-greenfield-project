import { NestFactory } from '@nestjs/core';
import { VideoWorkerModule } from '../../video-worker.module';
import { UploadReconcilerService } from '../upload-reconciler.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { ProcessingQueueService } from './processing-queue.service';
import { CleanupCoordinatorService } from '../cleanup-coordinator.service';

describe('VideoWorkerModule (integration)', () => {
  it('boots as a standalone context with worker-only services', async () => {
    const application = await NestFactory.createApplicationContext(
      VideoWorkerModule,
      { abortOnError: false, logger: ['error'] },
    );

    expect(application.get(ProcessingQueueService)).toBeDefined();
    expect(application.get(OutboxDispatcherService)).toBeDefined();
    expect(application.get(UploadReconcilerService)).toBeDefined();
    expect(application.get(CleanupCoordinatorService)).toBeDefined();

    await application.close();
  });
});
