import { DomainException } from '../common/exceptions/domain.exception';
import { VideoUploadError } from './video-upload.service';

const STATUS_BY_CODE: Record<VideoUploadError['code'], number> = {
  CHANNEL_REQUIRED: 403,
  IDEMPOTENCY_CONFLICT: 409,
  UPLOAD_QUOTA_EXCEEDED: 429,
  IDENTIFIER_ALLOCATION_FAILED: 503,
  VALIDATION_ERROR: 400,
  STORAGE_UNAVAILABLE: 503,
  VIDEO_NOT_FOUND: 404,
  VIDEO_NOT_READY: 409,
  UPLOAD_STATE_CONFLICT: 409,
  UPLOAD_EXPIRED: 410,
  UPLOAD_INCOMPLETE: 409,
  UPLOAD_SIZE_MISMATCH: 422,
};

export class VideoDomainException extends DomainException {
  constructor(error: VideoUploadError) {
    super(error.code, STATUS_BY_CODE[error.code], error.code);
  }
}

export class BodyTooLargeException extends DomainException {
  constructor() {
    super('BODY_TOO_LARGE', 413, 'Video control body exceeds 64KiB');
  }
}

export class VideoTooLargeException extends DomainException {
  constructor() {
    super('VIDEO_TOO_LARGE', 413, 'Video size exceeds 10GB');
  }
}

export class UnsupportedMediaTypeException extends DomainException {
  constructor() {
    super('UNSUPPORTED_MEDIA_TYPE', 415, 'Only video/mp4 is supported');
  }
}

export class VideoValidationException extends DomainException {
  constructor(message: string) {
    super('VALIDATION_ERROR', 400, message);
  }
}
