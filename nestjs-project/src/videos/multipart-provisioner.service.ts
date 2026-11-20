import { Injectable } from '@nestjs/common';
import type { MultipartUpload } from '@aws-sdk/client-s3';
import { StorageService } from '../storage/storage.service';
import { VideoUploadRepository } from './video-upload.repository';

export interface MultipartProvisioningRequest {
  sessionId: string;
  videoId: string;
  sourceKey: string;
  operationToken: string;
  contentType: string;
}

@Injectable()
export class MultipartProvisionerService {
  constructor(
    private readonly repository: VideoUploadRepository,
    private readonly storage: StorageService,
  ) {}

  async provision(request: MultipartProvisioningRequest): Promise<boolean> {
    let leaseValid = await this.repository.renewProvisioningLease(
      request.sessionId,
      request.operationToken,
    );
    if (!leaseValid) return this.cleanupAfterFence(request, []);

    let candidates = this.exactCandidates(
      request.sourceKey,
      await this.storage.listMultipartUploads(request.sourceKey),
    );
    leaseValid = await this.repository.renewProvisioningLease(
      request.sessionId,
      request.operationToken,
    );

    if (leaseValid && candidates.length === 0) {
      const createdUploadId = await this.storage.createMultipartUpload(
        request.sourceKey,
        request.contentType,
      );
      candidates = this.exactCandidates(request.sourceKey, [
        ...(await this.storage.listMultipartUploads(request.sourceKey)),
        { Key: request.sourceKey, UploadId: createdUploadId },
      ]);
      leaseValid = await this.repository.renewProvisioningLease(
        request.sessionId,
        request.operationToken,
      );
    }

    const candidate = candidates[0];
    if (leaseValid && candidate?.UploadId) {
      await this.repository.adoptProvisionedMultipart(
        request.sessionId,
        request.operationToken,
        candidate.UploadId,
      );
    }
    return this.cleanupAfterFence(request, candidates);
  }

  private async cleanupAfterFence(
    request: MultipartProvisioningRequest,
    candidates: MultipartUpload[],
  ): Promise<boolean> {
    const persisted = await this.repository.findProvisioningState(
      request.sessionId,
    );
    const winner = persisted?.storage_upload_id;
    if (persisted?.state !== 'uploading' || !winner) return false;

    for (const candidate of candidates) {
      if (!candidate.UploadId || candidate.UploadId === winner) continue;
      if (
        !(await this.repository.isPersistedProvisioningWinner(
          request.sessionId,
          winner,
        ))
      )
        return false;
      await this.storage.abortMultipartUpload(
        request.sourceKey,
        candidate.UploadId,
      );
    }
    return true;
  }

  private exactCandidates(
    key: string,
    uploads: MultipartUpload[],
  ): MultipartUpload[] {
    const unique = new Map<string, MultipartUpload>();
    for (const upload of uploads) {
      if (upload.Key !== key || !upload.UploadId) continue;
      const existing = unique.get(upload.UploadId);
      if (!existing?.Initiated || upload.Initiated)
        unique.set(upload.UploadId, upload);
    }
    return [...unique.values()].sort((left, right) => {
      const initiated =
        (left.Initiated?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.Initiated?.getTime() ?? Number.MAX_SAFE_INTEGER);
      return initiated || left.UploadId!.localeCompare(right.UploadId!);
    });
  }
}
