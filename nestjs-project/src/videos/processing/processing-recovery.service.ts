import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import videoConfig from '../../config/video.config';
import { StorageService } from '../../storage/storage.service';
import { ProcessingQueueService } from './processing-queue.service';
import { ProcessingRecoveryRepository } from './processing-recovery.repository';
import { safeErrorContext } from '../../common/logging/safe-log-context';

@Injectable()
export class ProcessingRecoveryService {
  private readonly logger = new Logger(ProcessingRecoveryService.name);

  constructor(
    private readonly recoveryRepository: ProcessingRecoveryRepository,
    private readonly processingQueue: ProcessingQueueService,
    private readonly storage: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async reconcileOnce(): Promise<number> {
    const videos = await this.recoveryRepository.findRecoverableVideos();
    let recovered = 0;
    for (const video of videos) {
      if (video.processing_attempts >= 3) {
        await this.recoveryRepository.finalizeExhausted(video.id);
        recovered += 1;
        continue;
      }
      let job: Job<unknown, unknown> | undefined;
      try {
        job = (await this.processingQueue.queue.getJob(
          `video-${video.id}-v1`,
        )) as Job<unknown, unknown> | undefined;
        const state = job ? await job.getState() : 'missing';
        if (
          state === 'active' ||
          state === 'waiting' ||
          state === 'delayed' ||
          state === 'waiting-children'
        ) {
          continue;
        }
        if (job && (state === 'failed' || state === 'completed'))
          await job.remove();
      } catch (error: unknown) {
        this.logger.error({
          message: 'Cannot inspect processing job; recovery deferred',
          videoId: video.id,
          ...safeErrorContext(error),
        });
        continue;
      }
      if (await this.recoveryRepository.requeueOutbox(video.id)) recovered += 1;
    }
    return recovered;
  }

  async cleanAbandonedAttempts(): Promise<number> {
    const videos = await this.recoveryRepository.findAbandonedVideos();
    let cleaned = 0;
    for (const video of videos) {
      try {
        const keys = await this.storage.listObjectKeys(
          `videos/${video.id}/attempts/`,
        );
        const current = await this.recoveryRepository.findProcessingAttempt(
          video.id,
        );
        if (current?.status !== 'processing' || current.lease_active) continue;
        const staleAttempts = new Set<string>();
        for (const key of keys) {
          const attempt = key
            .slice(`videos/${video.id}/attempts/`.length)
            .split('/')[0];
          if (!attempt || attempt === current.attempt_id) continue;
          await this.storage.deleteObject(key);
          staleAttempts.add(attempt);
          cleaned += 1;
        }
        for (const attempt of staleAttempts) {
          await rm(join(this.config.workDirectory, video.id, attempt), {
            recursive: true,
            force: true,
          });
        }
      } catch (error: unknown) {
        this.logger.error({
          message: 'Abandoned attempt cleanup deferred',
          videoId: video.id,
          ...safeErrorContext(error),
        });
      }
    }
    return cleaned;
  }
}
