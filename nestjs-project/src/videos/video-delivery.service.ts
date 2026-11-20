import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import { VideoUploadError } from './video-upload.service';
import { VideosRepository } from './videos.repository';

export type VideoMediaKind = 'stream' | 'download' | 'thumbnail';

@Injectable()
export class VideoDeliveryService {
  constructor(
    private readonly repository: VideosRepository,
    private readonly storage: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async signedLocation(
    userId: string,
    publicId: string,
    kind: VideoMediaKind,
    method: 'GET' | 'HEAD',
  ): Promise<string> {
    const video = await this.repository.findOwnedVideo(userId, publicId);
    if (!video) throw new VideoUploadError('VIDEO_NOT_FOUND');
    if (video.status !== 'ready') throw new VideoUploadError('VIDEO_NOT_READY');
    const key =
      kind === 'stream'
        ? video.stream_key
        : kind === 'thumbnail'
          ? video.thumbnail_key
          : video.source_key;
    if (!key) throw new VideoUploadError('VIDEO_NOT_READY');
    try {
      if (method === 'HEAD')
        return await this.storage.signHead(key, this.config.urlTtlSeconds);
      if (kind === 'download') {
        const safeFilename =
          video.original_filename
            .replaceAll(/[/\\";]/g, '_')
            .split('')
            .map((character) => {
              const code = character.charCodeAt(0);
              return code >= 32 && code <= 126 ? character : '_';
            })
            .join('')
            .slice(0, 255) || 'video.mp4';
        return await this.storage.signGet(
          key,
          this.config.urlTtlSeconds,
          `attachment; filename="${safeFilename}"`,
        );
      }
      return await this.storage.signGet(key, this.config.urlTtlSeconds);
    } catch {
      throw new VideoUploadError('STORAGE_UNAVAILABLE');
    }
  }
}
