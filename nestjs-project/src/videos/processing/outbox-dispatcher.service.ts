import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { safeErrorContext } from '../../common/logging/safe-log-context';
import { OutboxRepository } from './outbox.repository';
import { ProcessingQueueService } from './processing-queue.service';

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly processingQueue: ProcessingQueueService,
  ) {}

  async dispatchOnce(): Promise<number> {
    const token = randomUUID();
    const claimed = await this.outboxRepository.claimBatch(token);

    let published = 0;
    for (const row of claimed) {
      try {
        await this.withTimeout(
          this.processingQueue.queue.add('process-video', row.payload, {
            jobId: `video-${row.video_id}-v1`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: { age: 7 * 24 * 60 * 60 },
            removeOnFail: { age: 7 * 24 * 60 * 60 },
          }),
          2_000,
        );
        await this.outboxRepository.markPublished(row.id, token);
        published += 1;
      } catch (error: unknown) {
        this.logger.error({
          event: 'video_outbox_publish_deferred',
          outboxId: row.id,
          videoId: row.video_id,
          ...safeErrorContext(error),
        });
        await this.outboxRepository.markPublishFailed(row.id, token);
      }
    }
    return published;
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Queue publish timed out')),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
