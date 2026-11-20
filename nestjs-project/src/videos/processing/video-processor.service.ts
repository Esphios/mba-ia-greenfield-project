import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import videoConfig from '../../config/video.config';
import { StorageService } from '../../storage/storage.service';
import type { VideoMetadata } from '../entities/video.entity';
import { VideosRepository } from '../videos.repository';
import { safeErrorContext } from '../../common/logging/safe-log-context';

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  disposition?: { attached_pic?: number };
}

interface ProbeResult {
  streams?: ProbeStream[];
  format?: { format_name?: string; duration?: string };
}

class ProcessingFailure extends Error {
  constructor(
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(code);
  }
}

@Injectable()
export class VideoProcessorService {
  private readonly logger = new Logger(VideoProcessorService.name);

  constructor(
    private readonly repository: VideosRepository,
    private readonly storage: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async verifyRuntime(): Promise<void> {
    await Promise.all([
      this.runCommand('ffmpeg', ['-version'], 10_000, 16_384),
      this.runCommand('ffprobe', ['-version'], 10_000, 16_384),
    ]);
    await mkdir(this.config.workDirectory, { recursive: true });
    const disk = await statfs(this.config.workDirectory);
    if (disk.bavail * disk.bsize < 40 * 1024 ** 3) {
      throw new Error('Worker scratch has less than 40 GiB free');
    }
  }

  async process(videoId: string): Promise<void> {
    const video = await this.repository.claimProcessing(videoId);
    if (!video) {
      const current = await this.repository.findProcessingState(videoId);
      if (current?.status === 'ready' || current?.status === 'error') return;
      throw new ProcessingFailure('PROCESSING_DEFERRED', false);
    }
    const attemptId = video.attempt_id;
    if (!attemptId) throw new Error('Processing claim has no attempt id');
    const expectedBytes = Number(video.size_bytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
      throw new Error('Processing claim has an invalid source size');
    }
    const directory = join(this.config.workDirectory, video.id, attemptId);
    const sourcePath = join(directory, 'source.mp4');
    const streamPath = join(directory, 'stream.mp4');
    const thumbnailPath = join(directory, 'thumbnail.jpg');
    const streamKey = `videos/${video.id}/attempts/${attemptId}/stream.mp4`;
    const thumbnailKey = `videos/${video.id}/attempts/${attemptId}/thumbnail.jpg`;
    const testDeadline =
      process.env.NODE_ENV === 'test'
        ? Number(process.env.VIDEO_TEST_TOTAL_DEADLINE_MS)
        : NaN;
    const deadline =
      Date.now() +
      (Number.isSafeInteger(testDeadline) && testDeadline > 0
        ? testDeadline
        : 90 * 60_000);
    const cancellation = new AbortController();
    const deadlineTimer = setTimeout(
      () =>
        cancellation.abort(new ProcessingFailure('PROCESSING_TIMEOUT', false)),
      Math.max(1, deadline - Date.now()),
    );
    deadlineTimer.unref();
    let leaseLost = false;
    const heartbeatMs =
      process.env.NODE_ENV === 'test'
        ? Number(process.env.VIDEO_TEST_HEARTBEAT_MS ?? 20_000)
        : 20_000;
    const heartbeat = setInterval(
      () => {
        void this.repository.heartbeat(video.id, attemptId).then(
          (valid) => {
            if (!valid) {
              leaseLost = true;
              cancellation.abort(
                new ProcessingFailure('PROCESSING_FAILED', false),
              );
            }
          },
          () => {
            leaseLost = true;
            cancellation.abort(
              new ProcessingFailure('PROCESSING_FAILED', false),
            );
          },
        );
      },
      Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : 20_000,
    );
    heartbeat.unref();
    try {
      if (process.env.NODE_ENV === 'test') {
        const hold = Number(process.env.VIDEO_TEST_HOLD_AFTER_CLAIM_MS ?? 0);
        if (Number.isFinite(hold) && hold > 0) {
          await new Promise((resolve) => setTimeout(resolve, hold));
        }
      }
      await mkdir(directory, { recursive: true });
      const disk = await statfs(directory);
      if (disk.bavail * disk.bsize < expectedBytes * 2 + 1024 ** 3) {
        throw new ProcessingFailure('INSUFFICIENT_DISK', false);
      }
      const source = await this.storage.downloadStream(
        video.source_key,
        expectedBytes,
        cancellation.signal,
      );
      await pipeline(source, createWriteStream(sourcePath), {
        signal: cancellation.signal,
      });
      if ((await stat(sourcePath)).size !== expectedBytes) {
        throw new ProcessingFailure('INVALID_VIDEO', true);
      }
      const probeOutput = await this.runCommand(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_format',
          '-show_streams',
          '-of',
          'json',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          'mov',
          sourcePath,
        ],
        this.remaining(deadline, 60_000),
        1024 * 1024,
        cancellation.signal,
      );
      let probe: ProbeResult;
      try {
        probe = JSON.parse(probeOutput) as ProbeResult;
      } catch {
        throw new ProcessingFailure('INVALID_VIDEO', true);
      }
      const { metadata, durationMs, videoIndex, audioIndex } =
        this.validateProbe(probe);
      const maps = ['-map', `0:${videoIndex}`];
      if (audioIndex !== null) maps.push('-map', `0:${audioIndex}`);
      await this.runCommand(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-xerror',
          '-err_detect',
          'explode',
          '-protocol_whitelist',
          'file,pipe',
          '-f',
          'mov',
          '-i',
          sourcePath,
          ...maps,
          '-f',
          'null',
          '/dev/null',
        ],
        this.remaining(deadline, 60 * 60_000),
        65_536,
        cancellation.signal,
      );
      if (leaseLost) throw new ProcessingFailure('PROCESSING_FAILED', false);
      await this.runCommand(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-f',
          'mov',
          '-i',
          sourcePath,
          '-map',
          `0:${videoIndex}`,
          '-vf',
          'scale=640:360:force_original_aspect_ratio=decrease',
          '-frames:v',
          '1',
          '-q:v',
          '2',
          thumbnailPath,
        ],
        this.remaining(deadline, 60_000),
        65_536,
        cancellation.signal,
        'PROCESSING_FAILED',
      );
      await this.runCommand(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-f',
          'mov',
          '-i',
          sourcePath,
          ...maps,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          streamPath,
        ],
        this.remaining(deadline, 60 * 60_000),
        65_536,
        cancellation.signal,
        'PROCESSING_FAILED',
      );
      if (leaseLost) throw new ProcessingFailure('PROCESSING_FAILED', false);
      await this.storage.uploadStream(
        streamKey,
        createReadStream(streamPath),
        'video/mp4',
        expectedBytes + 1024 ** 3,
        cancellation.signal,
      );
      await this.storage.uploadStream(
        thumbnailKey,
        createReadStream(thumbnailPath),
        'image/jpeg',
        10 * 1024 ** 2,
        cancellation.signal,
      );
      await Promise.all([
        this.storage.headObject(streamKey, cancellation.signal),
        this.storage.headObject(thumbnailKey, cancellation.signal),
      ]);
      if (leaseLost) throw new ProcessingFailure('PROCESSING_FAILED', false);
      this.throwIfCancelled(cancellation.signal);
      const changed = await this.repository.markReady(
        video.id,
        attemptId,
        durationMs,
        metadata,
        streamKey,
        thumbnailKey,
        new Date(deadline),
      );
      this.throwIfCancelled(cancellation.signal);
      if (!changed) throw new ProcessingFailure('PROCESSING_FAILED', false);
    } catch (error: unknown) {
      this.logger.error({
        message: 'Processing attempt failed',
        videoId,
        attemptId,
        ...safeErrorContext(error),
      });
      const failure = cancellation.signal.aborted
        ? this.cancellationFailure(cancellation.signal)
        : error instanceof ProcessingFailure
          ? error
          : new ProcessingFailure('PROCESSING_FAILED', false);
      try {
        const committed = await this.repository.findProcessingState(video.id);
        if (
          committed?.status === 'ready' &&
          committed.stream_key === streamKey &&
          committed.thumbnail_key === thumbnailKey
        )
          return;
        await this.repository.recordProcessingFailure(
          video.id,
          attemptId,
          failure.permanent,
          failure.code,
        );
        const latest = await this.repository.findProcessingState(video.id);
        if (
          latest?.status === 'ready' &&
          latest.stream_key === streamKey &&
          latest.thumbnail_key === thumbnailKey
        )
          return;
        if (
          latest?.stream_key !== streamKey &&
          latest?.thumbnail_key !== thumbnailKey
        ) {
          await Promise.all([
            this.storage.deleteObject(streamKey),
            this.storage.deleteObject(thumbnailKey),
          ]);
        }
      } catch (databaseError: unknown) {
        this.logger.error({
          message:
            'Could not reconcile processing failure; derived cleanup deferred',
          videoId,
          attemptId,
          ...safeErrorContext(databaseError),
        });
      }
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
      clearInterval(heartbeat);
      await rm(directory, { recursive: true, force: true });
    }
  }

  private validateProbe(probe: ProbeResult): {
    metadata: VideoMetadata;
    durationMs: number;
    videoIndex: number;
    audioIndex: number | null;
  } {
    const streams = probe.streams ?? [];
    const videos = streams.filter((stream) => stream.codec_type === 'video');
    const audios = streams.filter((stream) => stream.codec_type === 'audio');
    if (videos.length === 0) {
      throw new ProcessingFailure('INVALID_VIDEO', true);
    }
    if (
      videos.length !== 1 ||
      audios.length > 1 ||
      streams.length !== videos.length + audios.length
    ) {
      throw new ProcessingFailure('UNSUPPORTED_VIDEO', true);
    }
    const video = videos[0];
    const audio = audios[0];
    if (
      video.codec_name !== 'h264' ||
      video.pix_fmt !== 'yuv420p' ||
      video.disposition?.attached_pic ||
      (audio && audio.codec_name !== 'aac')
    ) {
      throw new ProcessingFailure('UNSUPPORTED_VIDEO', true);
    }
    const fps = video.avg_frame_rate?.split('/').map(Number) ?? [];
    const durationMs = Math.round(Number(probe.format?.duration) * 1000);
    if (
      !Number.isInteger(video.index) ||
      (audio && !Number.isInteger(audio.index)) ||
      !Number.isInteger(video.width) ||
      !Number.isInteger(video.height) ||
      video.width! < 1 ||
      video.height! < 1 ||
      video.width! > 3840 ||
      video.height! > 2160 ||
      fps.length !== 2 ||
      !fps.every(Number.isSafeInteger) ||
      fps[0] < 1 ||
      fps[1] < 1 ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1 ||
      !probe.format?.format_name?.split(',').includes('mov')
    ) {
      throw new ProcessingFailure('INVALID_VIDEO', true);
    }
    return {
      metadata: {
        format: 'mp4',
        videoCodec: 'h264',
        audioCodec: audio ? 'aac' : null,
        width: video.width!,
        height: video.height!,
        fps: { numerator: fps[0], denominator: fps[1] },
      },
      durationMs,
      videoIndex: video.index!,
      audioIndex: audio?.index ?? null,
    };
  }

  private remaining(deadline: number, limit: number): number {
    const remaining = Math.min(limit, deadline - Date.now());
    if (remaining <= 0)
      throw new ProcessingFailure('PROCESSING_TIMEOUT', false);
    return remaining;
  }

  runCommand(
    command: string,
    args: string[],
    timeoutMs: number,
    outputLimit: number,
    signal?: AbortSignal,
    exitFailure: 'INVALID_VIDEO' | 'PROCESSING_FAILED' = 'INVALID_VIDEO',
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let errorOutput = '';
      let timedOut = false;
      let cancelled = false;
      let forceKill: NodeJS.Timeout | undefined;
      const cancel = () => {
        cancelled = true;
        child.kill('SIGTERM');
        forceKill = setTimeout(() => child.kill('SIGKILL'), 1_000);
        forceKill.unref();
      };
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > outputLimit) child.kill('SIGKILL');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
        if (errorOutput.length > outputLimit) child.kill('SIGKILL');
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        if (forceKill) clearTimeout(forceKill);
        signal?.removeEventListener('abort', cancel);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (forceKill) clearTimeout(forceKill);
        signal?.removeEventListener('abort', cancel);
        if (cancelled) reject(this.cancellationFailure(signal));
        else if (timedOut)
          reject(new ProcessingFailure('PROCESSING_TIMEOUT', false));
        else if (
          output.length > outputLimit ||
          errorOutput.length > outputLimit
        )
          reject(new ProcessingFailure('INVALID_VIDEO', true));
        else if (code !== 0) {
          const infrastructureFailure = /ENOSPC|no space left|I\/O error/i.test(
            errorOutput,
          );
          const code = infrastructureFailure
            ? 'PROCESSING_FAILED'
            : exitFailure;
          reject(new ProcessingFailure(code, code !== 'PROCESSING_FAILED'));
        } else resolve(output);
      });
    });
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw this.cancellationFailure(signal);
  }

  private cancellationFailure(signal?: AbortSignal): ProcessingFailure {
    return signal?.reason instanceof ProcessingFailure
      ? signal.reason
      : new ProcessingFailure('PROCESSING_FAILED', false);
  }
}
