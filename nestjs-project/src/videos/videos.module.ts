import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { VideoBodyLimitGuard } from './video-body-limit.guard';
import { VideoPersistenceModule } from './video-persistence.module';
import { VideoUploadService } from './video-upload.service';
import { VideoDeliveryService } from './video-delivery.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [ChannelsModule, StorageModule, VideoPersistenceModule],
  controllers: [VideosController],
  providers: [VideoUploadService, VideoDeliveryService, VideoBodyLimitGuard],
  exports: [VideoUploadService],
})
export class VideosModule {}
