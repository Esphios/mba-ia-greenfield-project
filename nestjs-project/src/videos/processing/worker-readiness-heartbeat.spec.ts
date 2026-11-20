import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkerReadinessHeartbeat,
  type ReadinessWorker,
} from './worker-readiness-heartbeat';

describe('WorkerReadinessHeartbeat', () => {
  let directory: string;
  let readinessFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'worker-readiness-'));
    readinessFile = join(directory, 'ready');
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  async function exists(): Promise<boolean> {
    return access(readinessFile).then(
      () => true,
      () => false,
    );
  }

  it('renews only while the worker and Redis consumer are currently ready', async () => {
    const client = { status: 'ready', ping: jest.fn(async () => 'PONG') };
    const worker = {
      isRunning: jest.fn(() => true),
      client: Promise.resolve(client),
    } satisfies ReadinessWorker;
    const heartbeat = new WorkerReadinessHeartbeat(worker, readinessFile);

    await expect(heartbeat.refresh()).resolves.toBe(true);
    expect(await exists()).toBe(true);

    client.status = 'reconnecting';
    await expect(heartbeat.refresh()).resolves.toBe(false);
    expect(await exists()).toBe(false);

    client.status = 'ready';
    await expect(heartbeat.refresh()).resolves.toBe(true);
    expect(await exists()).toBe(true);

    worker.isRunning.mockReturnValue(false);
    await expect(heartbeat.refresh()).resolves.toBe(false);
    expect(await exists()).toBe(false);
  });
});
