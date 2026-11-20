import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';
import {
  UploadReconcilerRepository,
  type RecoverableSessionRow,
} from './upload-reconciler.repository';
import { MultipartProvisionerService } from './multipart-provisioner.service';
import { safeErrorContext } from '../common/logging/safe-log-context';
import { VIDEO_PART_BYTES } from '../common/video-limits';

type RecoverableSession = RecoverableSessionRow;
type InitiatingSession = RecoverableSessionRow;

type CompletingSession = RecoverableSessionRow;

class LeaseLostError extends Error {}

@Injectable()
export class UploadReconcilerService {
  private readonly logger = new Logger(UploadReconcilerService.name);

  constructor(
    private readonly repository: UploadReconcilerRepository,
    private readonly storage: StorageService,
    private readonly provisioner: MultipartProvisionerService,
  ) {}

  async reconcileInitiating(): Promise<number> {
    const operationToken = randomUUID();
    const sessions = await this.repository.claimInitiating(operationToken);
    let recovered = 0;
    for (const session of sessions) {
      try {
        if (await this.recoverInitiatingSession(session)) recovered += 1;
      } catch (error: unknown) {
        this.logger.error({
          event: 'video_upload_provisioning_deferred',
          sessionId: session.id,
          videoId: session.video_id,
          stage: 'provisioning',
          ...safeErrorContext(error),
        });
        await this.repository.releaseInitiating(
          session.id,
          session.operation_token,
        );
      }
    }
    return recovered;
  }

  private async recoverInitiatingSession(
    session: InitiatingSession,
  ): Promise<boolean> {
    return this.provisioner.provision({
      sessionId: session.id,
      videoId: session.video_id,
      sourceKey: session.source_key,
      operationToken: session.operation_token,
      contentType: 'video/mp4',
    });
  }

  async sweepExpired(): Promise<number> {
    return this.repository.expireSessions();
  }

  async reconcileCompleting(): Promise<number> {
    const candidates = await this.repository.findCompletingCandidateIds();
    let recovered = 0;
    for (const candidate of candidates) {
      const session = await this.claimCompleting(candidate.id);
      if (!session) continue;
      try {
        if (await this.recoverCompletingSession(session)) recovered += 1;
      } catch (error: unknown) {
        if (!(error instanceof LeaseLostError)) {
          this.logger.error({
            event: 'video_upload_completion_recovery_deferred',
            sessionId: session.id,
            videoId: session.video_id,
            ...safeErrorContext(error),
          });
          await this.releaseCompletingClaim(session);
        }
      }
    }
    return recovered;
  }

  private async claimCompleting(id: string): Promise<CompletingSession | null> {
    const token = randomUUID();
    return this.repository.claimCompleting(id, token);
  }

  private async recoverCompletingSession(
    session: CompletingSession,
  ): Promise<boolean> {
    try {
      const head = await this.withCompletingHeartbeat(session, () =>
        this.storage.headObject(session.source_key),
      );
      if (head.ContentLength !== Number(session.size_bytes)) {
        await this.transitionCompleting(session, 'UPLOAD_SIZE_MISMATCH');
        return false;
      }
      return this.finalizeRecoveredCompletion(session);
    } catch (error: unknown) {
      if (error instanceof LeaseLostError) throw error;
      if (!this.isNotFound(error)) throw error;
    }

    if (!session.storage_upload_id) {
      await this.transitionCompleting(session, 'UPLOAD_STORAGE_MISSING');
      return false;
    }

    let parts: { PartNumber?: number; Size?: number; ETag?: string }[];
    try {
      parts = await this.withCompletingHeartbeat(session, () =>
        this.storage.listParts(session.source_key, session.storage_upload_id!),
      );
    } catch (error: unknown) {
      if (error instanceof LeaseLostError) throw error;
      if (!this.isNotFound(error)) throw error;
      await this.transitionCompleting(session, 'UPLOAD_STORAGE_MISSING');
      return false;
    }

    if (!this.hasAllExpectedParts(session, parts)) {
      await this.returnIncompleteCompletion(session);
      return false;
    }
    await this.withCompletingHeartbeat(session, () =>
      this.storage.completeMultipartUpload(
        session.source_key,
        session.storage_upload_id!,
        parts.map((part) => ({
          PartNumber: part.PartNumber,
          ETag: part.ETag,
        })),
      ),
    );
    const head = await this.withCompletingHeartbeat(session, () =>
      this.storage.headObject(session.source_key),
    );
    if (head.ContentLength !== Number(session.size_bytes)) {
      await this.transitionCompleting(session, 'UPLOAD_SIZE_MISMATCH');
      return false;
    }
    return this.finalizeRecoveredCompletion(session);
  }

  private async returnIncompleteCompletion(
    session: CompletingSession,
  ): Promise<void> {
    await this.repository.returnIncomplete(session.id, session.operation_token);
  }

  private async transitionCompleting(
    session: CompletingSession,
    errorCode: string,
  ): Promise<void> {
    await this.repository.transitionCompleting(
      session.id,
      session.operation_token,
      errorCode,
    );
  }

  private async withCompletingHeartbeat<T>(
    session: CompletingSession,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!(await this.renewCompletingLease(session))) throw new LeaseLostError();
    let leaseLost = false;
    const timer = setInterval(() => {
      void this.renewCompletingLease(session)
        .then((renewed) => {
          if (!renewed) leaseLost = true;
        })
        .catch((error: unknown) => {
          leaseLost = true;
          this.logger.error({
            event: 'video_upload_completion_lease_renewal_failed',
            sessionId: session.id,
            videoId: session.video_id,
            ...safeErrorContext(error),
          });
        });
    }, 30_000);
    timer.unref();
    try {
      const result = await operation();
      if (leaseLost || !(await this.renewCompletingLease(session))) {
        throw new LeaseLostError();
      }
      return result;
    } finally {
      clearInterval(timer);
    }
  }

  private async renewCompletingLease(
    session: CompletingSession,
  ): Promise<boolean> {
    return this.repository.renewCompletingLease(
      session.id,
      session.operation_token,
    );
  }

  private async releaseCompletingClaim(
    session: CompletingSession,
  ): Promise<void> {
    await this.repository.releaseCompleting(
      session.id,
      session.operation_token,
    );
  }

  private async finalizeRecoveredCompletion(
    session: CompletingSession,
  ): Promise<boolean> {
    return this.repository.finalizeRecoveredCompletion(session);
  }

  private hasAllExpectedParts(
    session: RecoverableSession,
    parts: { PartNumber?: number; Size?: number }[],
  ): boolean {
    return (
      parts.length === session.expected_parts &&
      parts.every((part, index) => {
        const number = index + 1;
        const expected =
          number === session.expected_parts
            ? Number(session.size_bytes) -
              VIDEO_PART_BYTES * (session.expected_parts - 1)
            : VIDEO_PART_BYTES;
        return part.PartNumber === number && part.Size === expected;
      })
    );
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
