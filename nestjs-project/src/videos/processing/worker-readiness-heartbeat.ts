import { rm, writeFile } from 'node:fs/promises';

const READINESS_INTERVAL_MS = 10_000;
const REDIS_PING_TIMEOUT_MS = 2_000;

export interface ReadinessWorker {
  isRunning(): boolean;
  client: Promise<{
    status: string;
    ping(): Promise<string>;
  }>;
}

export class WorkerReadinessHeartbeat {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly worker: ReadinessWorker,
    private readonly readinessFile: string,
  ) {}

  async start(): Promise<void> {
    if (!(await this.refresh())) throw new Error('Worker is not ready');
    this.timer = setInterval(() => {
      void this.refresh();
    }, READINESS_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await rm(this.readinessFile, { force: true });
  }

  async refresh(): Promise<boolean> {
    try {
      if (!this.worker.isRunning()) throw new Error('Worker is not running');
      const client = await this.worker.client;
      if (client.status !== 'ready') throw new Error('Redis is not ready');
      const response = await this.withTimeout(client.ping());
      if (response !== 'PONG') throw new Error('Redis ping failed');
      await writeFile(this.readinessFile, String(Date.now()));
      return true;
    } catch {
      await rm(this.readinessFile, { force: true });
      return false;
    }
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Redis readiness ping timed out')),
            REDIS_PING_TIMEOUT_MS,
          );
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
