import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { safeErrorContext } from '../common/logging/safe-log-context';
import { StorageService } from '../storage/storage.service';
import {
  CleanupObligationClaim,
  CleanupObligationRepository,
} from './cleanup-obligation.repository';
import { VideoScratchService } from './video-scratch.service';

@Injectable()
export class CleanupCoordinatorService {
  private readonly logger = new Logger(CleanupCoordinatorService.name);

  constructor(
    private readonly repository: CleanupObligationRepository,
    private readonly storage: StorageService,
    private readonly scratch: VideoScratchService,
  ) {}

  async reconcileDue(limit = 20): Promise<number> {
    const claims = await this.repository.claimDue(randomUUID(), limit);
    let confirmed = 0;
    for (const claim of claims) {
      try {
        if (!this.isCleanable(claim)) {
          await this.repository.reschedule(claim.session_id, claim.lock_token);
          continue;
        }
        await this.cleanAndVerify(claim);
        if (
          await this.repository.confirmAndReleaseQuota(
            claim.session_id,
            claim.lock_token,
            claim,
          )
        )
          confirmed += 1;
        else
          await this.repository.reschedule(claim.session_id, claim.lock_token);
      } catch (error: unknown) {
        this.logger.error({
          event: 'video_cleanup_deferred',
          sessionId: claim.session_id,
          videoId: claim.video_id,
          ...safeErrorContext(error),
        });
        await this.repository.reschedule(claim.session_id, claim.lock_token);
      }
    }
    return confirmed;
  }

  private isCleanable(claim: CleanupObligationClaim): boolean {
    return (
      claim.session_state === 'aborted' ||
      claim.session_state === 'expired' ||
      (claim.session_state === 'completed' &&
        (claim.video_status === 'ready' || claim.video_status === 'error'))
    );
  }

  private preservedKeys(claim: CleanupObligationClaim): Set<string> {
    if (claim.session_state !== 'completed') return new Set();
    if (claim.video_status === 'error') return new Set([claim.source_key]);
    if (claim.video_status !== 'ready') return new Set();
    return new Set(
      [claim.source_key, claim.stream_key, claim.thumbnail_key].filter(
        (key): key is string => key !== null,
      ),
    );
  }

  private async cleanAndVerify(claim: CleanupObligationClaim): Promise<void> {
    const prefix = `videos/${claim.video_id}/`;
    const preserved = this.preservedKeys(claim);
    const uploads = await this.storage.listMultipartUploads(prefix);
    if (
      claim.storage_upload_id &&
      (claim.session_state === 'aborted' || claim.session_state === 'expired')
    )
      uploads.push({
        Key: claim.source_key,
        UploadId: claim.storage_upload_id,
      });
    const seenUploads = new Set<string>();
    for (const upload of uploads) {
      if (!upload.Key || !upload.UploadId) continue;
      const identity = `${upload.Key}\0${upload.UploadId}`;
      if (seenUploads.has(identity)) continue;
      seenUploads.add(identity);
      try {
        await this.storage.abortMultipartUpload(upload.Key, upload.UploadId);
      } catch (error: unknown) {
        if (!this.isNotFound(error)) throw error;
      }
    }
    const keys = await this.storage.listObjectKeys(prefix);
    for (const key of keys) {
      if (!preserved.has(key)) {
        await this.storage.deleteObject(key);
        await this.assertObjectAbsent(key);
      }
    }
    await this.scratch.removeAndVerify(claim.video_id);

    const remainingUploads = await this.storage.listMultipartUploads(prefix);
    if (remainingUploads.length > 0)
      throw new Error('Multipart cleanup verification did not converge');
    const remainingKeys = await this.storage.listObjectKeys(prefix);
    if (remainingKeys.some((key) => !preserved.has(key)))
      throw new Error('Object cleanup verification did not converge');
  }

  private async assertObjectAbsent(key: string): Promise<void> {
    try {
      await this.storage.headObject(key);
    } catch (error: unknown) {
      if (this.isNotFound(error)) return;
      throw error;
    }
    throw new Error('Object still exists after cleanup');
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    );
  }
}
