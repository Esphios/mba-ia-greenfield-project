import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import queueConfig from '../../config/queue.config';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';

@Injectable()
export class ProcessingQueueService implements OnModuleDestroy {
  readonly queue: Queue;

  constructor(
    @Inject(queueConfig.KEY)
    config: ConfigType<typeof queueConfig>,
  ) {
    this.queue = new Queue(VIDEO_PROCESSING_QUEUE, {
      prefix: config.prefix,
      connection: {
        host: config.host,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        enableOfflineQueue: false,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
