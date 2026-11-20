import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MAX_VIDEO_BYTES, VIDEO_PART_BYTES } from '../common/video-limits';
import { PlainObjectBodyPipe } from '../common/pipes/plain-object-body.pipe';
import { CreateVideoDto } from './dto/create-video.dto';
import { SignPartsDto } from './dto/sign-parts.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import {
  CompleteUploadResponseDto,
  CreateVideoResponseDto,
  SignPartsResponseDto,
  VideoUploadStateDto,
  VideoViewDto,
} from './dto/video-view.dto';
import { VideoBodyLimitGuard } from './video-body-limit.guard';
import {
  VideoDeliveryService,
  type VideoMediaKind,
} from './video-delivery.service';
import {
  UnsupportedMediaTypeException,
  VideoDomainException,
  VideoTooLargeException,
  VideoValidationException,
} from './video-domain.exception';
import { VideoUploadError, VideoUploadService } from './video-upload.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@UseGuards(VideoBodyLimitGuard)
@Controller('videos')
export class VideosController {
  constructor(
    private readonly uploads: VideoUploadService,
    private readonly delivery: VideoDeliveryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an idempotent video upload draft' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({
    description: 'Upload draft created',
    type: CreateVideoResponseDto,
    headers: {
      Location: { schema: { type: 'string' } },
      'Retry-After': { schema: { type: 'string' } },
    },
  })
  @ApiOkResponse({
    description: 'Idempotent replay',
    type: CreateVideoResponseDto,
    headers: {
      Location: { schema: { type: 'string' } },
      'Retry-After': { schema: { type: 'string' } },
    },
  })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR' })
  @ApiForbiddenResponse({ description: 'CHANNEL_REQUIRED' })
  @ApiConflictResponse({ description: 'IDEMPOTENCY_CONFLICT' })
  @ApiTooManyRequestsResponse({ description: 'UPLOAD_QUOTA_EXCEEDED' })
  @ApiResponse({ status: 413, description: 'VIDEO_TOO_LARGE/BODY_TOO_LARGE' })
  @ApiResponse({ status: 415, description: 'UNSUPPORTED_MEDIA_TYPE' })
  @ApiResponse({
    status: 503,
    description: 'Storage or identifier unavailable',
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new PlainObjectBodyPipe()) body: CreateVideoDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!idempotencyKey || !this.isUuid(idempotencyKey))
      throw new VideoValidationException('Idempotency-Key must be a UUID');
    if (body.sizeBytes > MAX_VIDEO_BYTES) throw new VideoTooLargeException();
    if (body.contentType !== 'video/mp4')
      throw new UnsupportedMediaTypeException();
    try {
      const result = await this.uploads.createDraft(
        user.sub,
        idempotencyKey,
        body,
      );
      response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
      response.location(`/videos/${result.public_id}`);
      if (result.state === 'initiating') response.setHeader('Retry-After', '5');
      return {
        video: await this.uploads.getVideo(user.sub, result.public_id),
        upload: {
          state: result.state,
          partSize: VIDEO_PART_BYTES,
          partCount: result.expected_parts,
          expiresAt: result.expires_at,
          lastErrorCode: result.last_error_code,
        },
      };
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  @Post(':publicId/upload/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: SignPartsDto })
  @ApiOkResponse({
    type: SignPartsResponseDto,
    headers: { 'Cache-Control': { schema: { type: 'string' } } },
  })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR' })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'UPLOAD_STATE_CONFLICT' })
  @ApiResponse({ status: 410, description: 'UPLOAD_EXPIRED' })
  @ApiResponse({ status: 503, description: 'STORAGE_UNAVAILABLE' })
  async signParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body(new PlainObjectBodyPipe()) body: SignPartsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const parts = await this.uploads.signParts(
        user.sub,
        publicId,
        body.partNumbers,
      );
      return { parts };
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  @Get(':publicId/upload')
  @ApiOkResponse({
    type: VideoUploadStateDto,
    headers: { 'Retry-After': { schema: { type: 'string' } } },
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiResponse({ status: 503, description: 'STORAGE_UNAVAILABLE' })
  async uploadState(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.uploads.getUploadState(user.sub, publicId);
      if (result.state === 'initiating') response.setHeader('Retry-After', '5');
      return result;
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  @Post(':publicId/upload/completion')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: CompleteUploadDto, required: false })
  @ApiResponse({
    status: 202,
    type: CompleteUploadResponseDto,
    headers: { 'Retry-After': { schema: { type: 'string' } } },
  })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR/UPLOAD_INCOMPLETE' })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'UPLOAD_STATE_CONFLICT',
    headers: { 'Retry-After': { schema: { type: 'string' } } },
  })
  @ApiResponse({ status: 410, description: 'UPLOAD_EXPIRED' })
  @ApiResponse({ status: 422, description: 'UPLOAD_SIZE_MISMATCH' })
  @ApiResponse({ status: 503, description: 'STORAGE_UNAVAILABLE' })
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body(new PlainObjectBodyPipe(true)) _body: CompleteUploadDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return {
        publicId,
        status: await this.uploads.completeUpload(user.sub, publicId),
      };
    } catch (error: unknown) {
      if (
        error instanceof VideoUploadError &&
        error.code === 'UPLOAD_STATE_CONFLICT'
      ) {
        response.setHeader('Retry-After', '5');
      }
      this.rethrow(error);
    }
  }

  @Get(':publicId')
  @ApiOperation({ summary: 'Get the canonical owner-only video view' })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiOkResponse({ type: VideoViewDto })
  async getVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    try {
      return await this.uploads.getVideo(user.sub, publicId);
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  @Head(':publicId/stream')
  @ApiResponse({
    status: 307,
    description: 'Temporary private MP4 URL',
    headers: {
      Location: { schema: { type: 'string', format: 'uri' } },
      'Cache-Control': { schema: { type: 'string' } },
    },
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'VIDEO_NOT_READY' })
  async headStream(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.redirectMedia(user.sub, publicId, 'stream', 'HEAD', response);
  }

  @Get(':publicId/stream')
  @ApiOperation({ summary: 'Redirect owner to a temporary stream URL' })
  @ApiResponse({
    status: 307,
    description: 'Temporary private MP4 URL; Range handled by storage',
    headers: {
      Location: { schema: { type: 'string', format: 'uri' } },
      'Cache-Control': { schema: { type: 'string' } },
    },
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'VIDEO_NOT_READY' })
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.redirectMedia(user.sub, publicId, 'stream', 'GET', response);
  }

  @Head(':publicId/download')
  @ApiResponse({
    status: 307,
    description: 'Temporary private download URL',
    headers: {
      Location: { schema: { type: 'string', format: 'uri' } },
      'Cache-Control': { schema: { type: 'string' } },
    },
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'VIDEO_NOT_READY' })
  async headDownload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.redirectMedia(user.sub, publicId, 'download', 'HEAD', response);
  }

  @Get(':publicId/download')
  @ApiOperation({
    summary: 'Redirect owner to a temporary original download URL',
  })
  @ApiResponse({
    status: 307,
    description: 'Private original with attachment disposition',
    headers: {
      Location: { schema: { type: 'string', format: 'uri' } },
      'Cache-Control': { schema: { type: 'string' } },
    },
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'VIDEO_NOT_READY' })
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.redirectMedia(user.sub, publicId, 'download', 'GET', response);
  }

  @Head(':publicId/thumbnail')
  @ApiResponse({
    status: 307,
    description: 'Temporary private thumbnail URL',
    headers: {
      Location: { schema: { type: 'string', format: 'uri' } },
      'Cache-Control': { schema: { type: 'string' } },
    },
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'VIDEO_NOT_READY' })
  async headThumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.redirectMedia(user.sub, publicId, 'thumbnail', 'HEAD', response);
  }

  @Get(':publicId/thumbnail')
  @ApiOperation({ summary: 'Redirect owner to a temporary JPEG thumbnail URL' })
  @ApiResponse({
    status: 307,
    description: 'Private JPEG thumbnail',
    headers: {
      Location: { schema: { type: 'string', format: 'uri' } },
      'Cache-Control': { schema: { type: 'string' } },
    },
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'VIDEO_NOT_READY' })
  async thumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.redirectMedia(user.sub, publicId, 'thumbnail', 'GET', response);
  }

  private async redirectMedia(
    userId: string,
    publicId: string,
    kind: VideoMediaKind,
    method: 'GET' | 'HEAD',
    response: Response,
  ): Promise<void> {
    try {
      const url = await this.delivery.signedLocation(
        userId,
        publicId,
        kind,
        method,
      );
      response.status(HttpStatus.TEMPORARY_REDIRECT);
      response.setHeader('Location', url);
      response.setHeader('Cache-Control', 'no-store');
      response.end();
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  @Delete(':publicId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiResponse({
    status: 204,
    description: 'Upload aborted or already terminal',
  })
  @ApiNotFoundResponse({ description: 'VIDEO_NOT_FOUND' })
  @ApiConflictResponse({ description: 'UPLOAD_STATE_CONFLICT' })
  @ApiResponse({ status: 503, description: 'STORAGE_UNAVAILABLE' })
  async abort(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    try {
      await this.uploads.abortUpload(user.sub, publicId);
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof VideoUploadError)
      throw new VideoDomainException(error);
    throw error;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }
}
