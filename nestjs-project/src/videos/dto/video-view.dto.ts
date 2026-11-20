import { ApiProperty } from '@nestjs/swagger';

export class VideoViewDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  publicId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: ['draft', 'processing', 'ready', 'error'] })
  status: string;

  @ApiProperty()
  sizeBytes: number;

  @ApiProperty({ nullable: true })
  durationMs: number | null;

  @ApiProperty({ type: Object, nullable: true })
  metadata: unknown;

  @ApiProperty({ nullable: true })
  failureCode: string | null;

  @ApiProperty()
  canonicalUrl: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class VideoUploadStateDto {
  @ApiProperty({
    enum: [
      'initiating',
      'uploading',
      'completing',
      'completed',
      'aborted',
      'expired',
    ],
  })
  state: string;

  @ApiProperty()
  partSize: number;

  @ApiProperty()
  partCount: number;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  @ApiProperty({ nullable: true })
  lastErrorCode: string | null;

  @ApiProperty({ type: () => [UploadedPartDto] })
  uploadedParts: UploadedPartDto[];
}

export class UploadedPartDto {
  @ApiProperty() partNumber: number;
  @ApiProperty() sizeBytes: number;
  @ApiProperty() etag: string;
}

export class SignedPartDto {
  @ApiProperty() partNumber: number;
  @ApiProperty({ format: 'uri' }) url: string;
  @ApiProperty() expectedSizeBytes: number;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

export class SignPartsResponseDto {
  @ApiProperty({ type: [SignedPartDto] }) parts: SignedPartDto[];
}

export class CompleteUploadResponseDto {
  @ApiProperty() publicId: string;
  @ApiProperty({ enum: ['processing', 'ready', 'error'] }) status: string;
}

export class CreateVideoResponseDto {
  @ApiProperty({ type: VideoViewDto })
  video: VideoViewDto;

  @ApiProperty({ type: VideoUploadStateDto })
  upload: VideoUploadStateDto;
}
