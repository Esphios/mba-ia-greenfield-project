import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { VideoUploadSession } from './entities/video-upload-session.entity';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { UploadReconcilerService } from './upload-reconciler.service';
import { StorageModule } from '../storage/storage.module';
import { VideoUploadRepository } from './video-upload.repository';
import { UploadReconcilerRepository } from './upload-reconciler.repository';
import { CleanupObligationRepository } from './cleanup-obligation.repository';
import { VideoCleanupObligation } from './entities/video-cleanup-obligation.entity';
import { CleanupCoordinatorService } from './cleanup-coordinator.service';
import { VideoScratchService } from './video-scratch.service';
import { MultipartProvisionerService } from './multipart-provisioner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Video,
      VideoUploadSession,
      VideoProcessingOutbox,
      VideoCleanupObligation,
    ]),
    StorageModule,
  ],
  providers: [
    VideosRepository,
    VideoUploadRepository,
    UploadReconcilerRepository,
    UploadReconcilerService,
    CleanupObligationRepository,
    VideoScratchService,
    CleanupCoordinatorService,
    MultipartProvisionerService,
  ],
  exports: [
    TypeOrmModule,
    VideosRepository,
    VideoUploadRepository,
    UploadReconcilerRepository,
    UploadReconcilerService,
    CleanupObligationRepository,
    CleanupCoordinatorService,
    MultipartProvisionerService,
  ],
})
export class VideoPersistenceModule {}
