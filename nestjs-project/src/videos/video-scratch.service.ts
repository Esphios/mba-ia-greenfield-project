import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import videoConfig from '../config/video.config';

@Injectable()
export class VideoScratchService {
  constructor(
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async removeAndVerify(videoId: string): Promise<void> {
    const path = join(this.config.workDirectory, videoId);
    await rm(path, { recursive: true, force: true });
    try {
      await lstat(path);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return;
      throw error;
    }
    throw new Error('Video scratch still exists after cleanup');
  }
}
