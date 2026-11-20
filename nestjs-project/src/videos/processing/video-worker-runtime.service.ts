import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { safeErrorContext } from '../../common/logging/safe-log-context';
import { UploadReconcilerService } from '../upload-reconciler.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { ProcessingRecoveryService } from './processing-recovery.service';
import { CleanupCoordinatorService } from '../cleanup-coordinator.service';

const DISPATCH_INTERVAL_MS = 5_000;
const RECONCILE_INTERVAL_MS = 30_000;

@Injectable()
export class VideoWorkerRuntimeService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(VideoWorkerRuntimeService.name);
  private dispatchTimer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  private dispatchCycle: Promise<void> = Promise.resolve();
  private reconcileCycle: Promise<void> = Promise.resolve();
  private dispatchRunning = false;
  private reconcileRunning = false;
  private stopping = false;

  constructor(
    private readonly dispatcher: OutboxDispatcherService,
    private readonly reconciler: UploadReconcilerService,
    private readonly recovery: ProcessingRecoveryService,
    private readonly cleanup: CleanupCoordinatorService,
  ) {}

  onApplicationBootstrap(): void {
    this.startDispatch();
    this.startReconciliation();
    this.dispatchTimer = setInterval(
      () => this.startDispatch(),
      DISPATCH_INTERVAL_MS,
    );
    this.reconcileTimer = setInterval(
      () => this.startReconciliation(),
      RECONCILE_INTERVAL_MS,
    );
    this.dispatchTimer.unref();
    this.reconcileTimer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    await Promise.all([this.dispatchCycle, this.reconcileCycle]);
  }

  private startDispatch(): void {
    if (this.stopping || this.dispatchRunning) return;
    this.dispatchRunning = true;
    this.dispatchCycle = this.runDispatch().finally(() => {
      this.dispatchRunning = false;
    });
  }

  private startReconciliation(): void {
    if (this.stopping || this.reconcileRunning) return;
    this.reconcileRunning = true;
    this.reconcileCycle = this.runReconciliation().finally(() => {
      this.reconcileRunning = false;
    });
  }

  private async runDispatch(): Promise<void> {
    try {
      await this.dispatcher.dispatchOnce();
    } catch (error: unknown) {
      this.logger.error({
        event: 'video_outbox_dispatch_failed',
        ...safeErrorContext(error),
      });
    }
  }

  private async runReconciliation(): Promise<void> {
    try {
      await this.reconciler.reconcileInitiating();
      await this.reconciler.reconcileCompleting();
      await this.reconciler.sweepExpired();
      await this.cleanup.reconcileDue();
      await this.recovery.reconcileOnce();
      await this.recovery.cleanAbandonedAttempts();
    } catch (error: unknown) {
      this.logger.error({
        event: 'video_worker_maintenance_failed',
        ...safeErrorContext(error),
      });
    }
  }
}
