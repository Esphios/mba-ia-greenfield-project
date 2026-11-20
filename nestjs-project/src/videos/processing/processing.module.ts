import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import queueConfig from '../../config/queue.config';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { ProcessingQueueService } from './processing-queue.service';
import { VideoProcessorService } from './video-processor.service';
import { ProcessingRecoveryService } from './processing-recovery.service';
import { VideoPersistenceModule } from '../video-persistence.module';
import { StorageModule } from '../../storage/storage.module';
import videoConfig from '../../config/video.config';
import { OutboxRepository } from './outbox.repository';
import { ProcessingRecoveryRepository } from './processing-recovery.repository';

@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
    ConfigModule.forFeature(videoConfig),
    VideoPersistenceModule,
    StorageModule,
  ],
  providers: [
    ProcessingQueueService,
    OutboxDispatcherService,
    VideoProcessorService,
    ProcessingRecoveryService,
    OutboxRepository,
    ProcessingRecoveryRepository,
  ],
  exports: [
    ProcessingQueueService,
    OutboxDispatcherService,
    VideoProcessorService,
    ProcessingRecoveryService,
  ],
})
export class ProcessingModule {}
