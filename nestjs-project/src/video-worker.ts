import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { rm } from 'node:fs/promises';
import { safeErrorContext } from './common/logging/safe-log-context';
import queueConfig from './config/queue.config';
import videoConfig from './config/video.config';
import { VideoWorkerModule } from './video-worker.module';
import { VIDEO_PROCESSING_QUEUE } from './videos/processing/processing-queue.service';
import { VideoProcessorService } from './videos/processing/video-processor.service';
import {
  WorkerReadinessHeartbeat,
  type ReadinessWorker,
} from './videos/processing/worker-readiness-heartbeat';

async function bootstrap(): Promise<void> {
  const readinessFile =
    process.env.VIDEO_WORKER_READINESS_FILE ?? '/tmp/video-worker-ready';
  await rm(readinessFile, { force: true });
  const application =
    await NestFactory.createApplicationContext(VideoWorkerModule);
  const logger = new Logger('VideoWorkerBootstrap');
  const processor = application.get(VideoProcessorService);
  try {
    await processor.verifyRuntime();
  } catch (error: unknown) {
    await application.close();
    throw error;
  }
  const queue = application.get<ConfigType<typeof queueConfig>>(
    queueConfig.KEY,
  );
  const video = application.get<ConfigType<typeof videoConfig>>(
    videoConfig.KEY,
  );
  const worker = new Worker(
    VIDEO_PROCESSING_QUEUE,
    async (job) => {
      const payload: unknown = job.data;
      const videoId: unknown =
        payload && typeof payload === 'object' && 'videoId' in payload
          ? payload.videoId
          : undefined;
      if (typeof videoId !== 'string')
        throw new Error('Invalid processing job');
      await processor.process(videoId);
    },
    {
      prefix: queue.prefix,
      connection: {
        host: queue.host,
        port: queue.port,
        password: queue.password,
      },
      concurrency: video.workerConcurrency,
      lockDuration: 120_000,
    },
  );
  worker.on('error', (error: Error) =>
    logger.error({ event: 'queue_worker_error', ...safeErrorContext(error) }),
  );
  worker.on('failed', (job, error: Error) =>
    logger.error({
      event: 'processing_job_failed',
      jobId: String(job?.id ?? 'unknown').slice(0, 128),
      ...safeErrorContext(error),
    }),
  );
  await worker.waitUntilReady();
  const readinessHeartbeat = new WorkerReadinessHeartbeat(
    worker as unknown as ReadinessWorker,
    readinessFile,
  );
  await readinessHeartbeat.start();
  logger.log('Video worker ready');

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await readinessHeartbeat.stop();
    await worker.close();
    await application.close();
  };
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}

void bootstrap().catch((error: unknown) => {
  Logger.error(
    { event: 'video_worker_bootstrap_failed', ...safeErrorContext(error) },
    'VideoWorkerBootstrap',
  );
  process.exitCode = 1;
});
