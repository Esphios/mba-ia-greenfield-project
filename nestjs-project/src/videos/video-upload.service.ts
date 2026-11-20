import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { StorageService } from '../storage/storage.service';
import type { CompletedPart } from '@aws-sdk/client-s3';
import { ChannelsService } from '../channels/channels.service';
import { VideosRepository } from './videos.repository';
import {
  hashVideoRequest,
  normalizeVideoRequest,
  type NormalizedVideoRequest,
} from './video-request-normalizer';
import videoConfig from '../config/video.config';
import {
  UploadPersistenceError,
  VideoUploadRepository,
  type OwnedUploadSessionRow,
} from './video-upload.repository';
import { MultipartProvisionerService } from './multipart-provisioner.service';
import { safeErrorContext } from '../common/logging/safe-log-context';
import { VIDEO_PART_BYTES } from '../common/video-limits';

export class VideoUploadError extends Error {
  constructor(
    readonly code:
      | 'CHANNEL_REQUIRED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'UPLOAD_QUOTA_EXCEEDED'
      | 'IDENTIFIER_ALLOCATION_FAILED'
      | 'VALIDATION_ERROR'
      | 'STORAGE_UNAVAILABLE'
      | 'VIDEO_NOT_FOUND'
      | 'VIDEO_NOT_READY'
      | 'UPLOAD_STATE_CONFLICT'
      | 'UPLOAD_EXPIRED'
      | 'UPLOAD_INCOMPLETE'
      | 'UPLOAD_SIZE_MISMATCH',
  ) {
    super(code);
  }
}

export type { DraftReservation as CreateDraftResult } from './video-upload.repository';
import type { DraftReservation as CreateDraftResult } from './video-upload.repository';

export interface VideoView {
  id: string;
  publicId: string;
  title: string;
  sizeBytes: number;
  status: string;
  durationMs: number | null;
  metadata: unknown;
  failureCode: string | null;
  canonicalUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class VideoUploadService {
  private readonly logger = new Logger(VideoUploadService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly channels: ChannelsService,
    private readonly videosRepository: VideosRepository,
    private readonly uploadRepository: VideoUploadRepository,
    private readonly provisioner: MultipartProvisionerService,
    @Inject(videoConfig.KEY)
    private readonly videoCfg: ConfigType<typeof videoConfig>,
  ) {}

  async createDraft(
    userId: string,
    idempotencyKey: string,
    input: Parameters<typeof normalizeVideoRequest>[0],
  ): Promise<CreateDraftResult> {
    let request: NormalizedVideoRequest;
    try {
      request = normalizeVideoRequest(input);
    } catch {
      throw new VideoUploadError('VALIDATION_ERROR');
    }
    const requestHash = hashVideoRequest(request);
    const operationToken = randomUUID();
    const channel = await this.channels.findByUserId(userId);
    if (!channel) throw new VideoUploadError('CHANNEL_REQUIRED');
    let draft: CreateDraftResult;
    try {
      draft = await this.uploadRepository.reserveDraft(
        channel.id,
        idempotencyKey.toLowerCase(),
        request,
        requestHash,
        operationToken,
        () => this.generatePublicId(),
      );
    } catch (error: unknown) {
      if (error instanceof UploadPersistenceError) {
        throw new VideoUploadError(error.code);
      }
      throw error;
    }

    if (!draft.provisioning) return draft;

    try {
      const adopted = await this.provisioner.provision({
        sessionId: draft.session_id,
        videoId: draft.video_id,
        sourceKey: `videos/${draft.video_id}/source.mp4`,
        operationToken,
        contentType: request.contentType,
      });
      if (!adopted) throw new VideoUploadError('UPLOAD_STATE_CONFLICT');
      return { ...draft, state: 'uploading', last_error_code: null };
    } catch (error: unknown) {
      this.logger.error({
        event: 'video_upload_provisioning_deferred',
        sessionId: draft.session_id,
        videoId: draft.video_id,
        stage: 'request',
        ...safeErrorContext(error),
      });
      await this.uploadRepository.markProvisioningUnavailable(
        draft.session_id,
        operationToken,
      );
      if (error instanceof VideoUploadError) throw error;
      throw new VideoUploadError('STORAGE_UNAVAILABLE');
    }
  }

  async signParts(
    userId: string,
    publicId: string,
    partNumbers: number[],
  ): Promise<
    {
      partNumber: number;
      url: string;
      expectedSizeBytes: number;
      expiresAt: string;
    }[]
  > {
    const session = await this.getOwnedSession(userId, publicId);
    if (session.state !== 'uploading') {
      if (session.state === 'expired')
        throw new VideoUploadError('UPLOAD_EXPIRED');
      throw new VideoUploadError('UPLOAD_STATE_CONFLICT');
    }
    const { remaining_seconds: remainingSeconds, db_now: dbNow } =
      await this.uploadRepository.getSigningClock(session.session_id);
    if (remainingSeconds <= 0) {
      await this.uploadRepository.expireUploading(session.session_id);
      throw new VideoUploadError('UPLOAD_EXPIRED');
    }
    const unique = [...new Set(partNumbers)];
    if (
      unique.length !== partNumbers.length ||
      unique.length < 1 ||
      unique.length > 20 ||
      unique.some(
        (partNumber) =>
          !Number.isInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > session.expected_parts,
      )
    ) {
      throw new VideoUploadError('VALIDATION_ERROR');
    }
    const expiresIn = Math.min(this.videoCfg.urlTtlSeconds, remainingSeconds);
    const expiresAt = new Date(
      dbNow.getTime() + expiresIn * 1000,
    ).toISOString();
    return this.storageCall(() =>
      Promise.all(
        unique.map(async (partNumber) => {
          const expectedSizeBytes = this.expectedPartSize(
            Number(session.size_bytes),
            session.expected_parts,
            partNumber,
          );
          return {
            partNumber,
            url: await this.storage.signUploadPart(
              session.source_key,
              session.storage_upload_id!,
              partNumber,
              expectedSizeBytes,
              expiresIn,
            ),
            requiredHeaders: {},
            expectedSizeBytes,
            expiresAt,
          };
        }),
      ),
    );
  }

  async listUploadedParts(userId: string, publicId: string) {
    const session = await this.getOwnedSession(userId, publicId);
    if (!session.storage_upload_id || session.state === 'initiating') return [];
    if (['completed', 'aborted', 'expired'].includes(session.state)) return [];
    return this.storageCall(() =>
      this.storage.listParts(session.source_key, session.storage_upload_id!),
    );
  }

  async getUploadState(userId: string, publicId: string) {
    const session = await this.getOwnedSession(userId, publicId);
    const uploadedParts = await this.listUploadedParts(userId, publicId);
    return {
      state: session.state,
      partSize: VIDEO_PART_BYTES,
      partCount: session.expected_parts,
      expiresAt: session.expires_at,
      uploadedParts: uploadedParts.map((part) => ({
        partNumber: part.PartNumber,
        sizeBytes: part.Size,
        etag: part.ETag,
      })),
      lastErrorCode: session.last_error_code,
    };
  }

  async getVideo(userId: string, publicId: string): Promise<VideoView> {
    const video = await this.videosRepository.findOwnedVideo(userId, publicId);
    if (!video) throw new VideoUploadError('VIDEO_NOT_FOUND');
    return {
      id: video.id,
      publicId: video.public_id,
      title: video.title,
      sizeBytes: Number(video.size_bytes),
      status: video.status,
      durationMs: video.duration_ms === null ? null : Number(video.duration_ms),
      metadata: video.metadata,
      failureCode: video.failure_code,
      canonicalUrl: `${this.videoCfg.publicUrl}/videos/${video.public_id}`,
      createdAt: video.created_at,
      updatedAt: video.updated_at,
    };
  }

  async completeUpload(userId: string, publicId: string): Promise<string> {
    const session = await this.getOwnedSession(userId, publicId);
    if (session.state === 'completed') return session.video_status;
    if (session.state === 'expired')
      throw new VideoUploadError('UPLOAD_EXPIRED');
    if (session.state !== 'uploading') {
      throw new VideoUploadError('UPLOAD_STATE_CONFLICT');
    }
    const token = randomUUID();
    const claim = await this.uploadRepository.claimCompletion(
      session.session_id,
      token,
    );
    if (claim.outcome === 'completed') return claim.videoStatus;
    if (claim.outcome === 'expired')
      throw new VideoUploadError('UPLOAD_EXPIRED');
    if (claim.outcome !== 'claimed')
      throw new VideoUploadError('UPLOAD_STATE_CONFLICT');

    const parts = await this.storageCall(() =>
      this.storage.listParts(session.source_key, session.storage_upload_id!),
    );
    const completePartSet =
      parts.length === session.expected_parts &&
      parts.every((part, index) => part.PartNumber === index + 1);
    if (!completePartSet) {
      const resetState = await this.uploadRepository.resetIncompleteCompletion(
        session.session_id,
        token,
      );
      throw new VideoUploadError(
        resetState === 'expired' ? 'UPLOAD_EXPIRED' : 'UPLOAD_INCOMPLETE',
      );
    }
    const correctSizes = parts.every(
      (part, index) =>
        part.Size ===
        this.expectedPartSize(
          Number(session.size_bytes),
          session.expected_parts,
          index + 1,
        ),
    );
    if (!correctSizes) {
      await this.storageCall(() =>
        this.storage.abortMultipartUpload(
          session.source_key,
          session.storage_upload_id!,
        ),
      );
      await this.uploadRepository.abortSizeMismatch(session.session_id, token);
      throw new VideoUploadError('UPLOAD_SIZE_MISMATCH');
    }

    const completedParts: CompletedPart[] = parts.map((part) => ({
      PartNumber: part.PartNumber,
      ETag: part.ETag,
    }));
    await this.storageCall(() =>
      this.storage.completeMultipartUpload(
        session.source_key,
        session.storage_upload_id!,
        completedParts,
      ),
    );
    const head = await this.storageCall(() =>
      this.storage.headObject(session.source_key),
    );
    if (head.ContentLength !== Number(session.size_bytes)) {
      await this.storageCall(() =>
        this.storage.deleteObject(session.source_key),
      );
      await this.uploadRepository.abortSizeMismatch(session.session_id, token);
      throw new VideoUploadError('UPLOAD_SIZE_MISMATCH');
    }

    const finalization = await this.uploadRepository.finalizeCompletion(
      session.session_id,
      session.video_id,
      token,
    );
    if (finalization.outcome === 'conflict')
      throw new VideoUploadError('UPLOAD_STATE_CONFLICT');
    const current = await this.getOwnedSession(userId, publicId);
    if (current.state !== 'completed')
      throw new VideoUploadError('UPLOAD_STATE_CONFLICT');
    return current.video_status;
  }

  async abortUpload(userId: string, publicId: string): Promise<void> {
    const session = await this.getOwnedSession(userId, publicId);
    if (['aborted', 'expired'].includes(session.state)) return;
    if (['completing', 'completed'].includes(session.state)) {
      throw new VideoUploadError('UPLOAD_STATE_CONFLICT');
    }
    if (!(await this.uploadRepository.abortSession(session.session_id))) {
      throw new VideoUploadError('UPLOAD_STATE_CONFLICT');
    }
    if (session.storage_upload_id) {
      await this.storageCall(() =>
        this.storage.abortMultipartUpload(
          session.source_key,
          session.storage_upload_id!,
        ),
      );
    }
  }

  private async getOwnedSession(
    userId: string,
    publicId: string,
  ): Promise<OwnedUploadSessionRow> {
    const session = await this.uploadRepository.observeOwnedSession(
      userId,
      publicId,
    );
    if (!session) throw new VideoUploadError('VIDEO_NOT_FOUND');
    return session;
  }

  private expectedPartSize(
    totalBytes: number,
    expectedParts: number,
    partNumber: number,
  ): number {
    return partNumber === expectedParts
      ? totalBytes - VIDEO_PART_BYTES * (expectedParts - 1)
      : VIDEO_PART_BYTES;
  }

  protected generatePublicId(): string {
    return randomBytes(16).toString('base64url');
  }

  private async storageCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new VideoUploadError('STORAGE_UNAVAILABLE');
    }
  }
}
