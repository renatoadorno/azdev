import type { Status } from '../interfaces/Serve';
import type { SyncEngine } from './engine';
import { nextSync } from './schedule';

export interface SchedulerOptions {
  /** Null while there is no credential: nothing to sync with. */
  engine(): SyncEngine | null;
  /** True while some client watches; with nobody, nothing is synced. */
  active(): boolean;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

/**
 * Keeps one timer, set for the next sync the schedule asks for. Call `poke` when
 * anything the schedule depends on changes (a watch starts or ends, a sync ends).
 */
export class SyncScheduler {
  private timer: unknown = null;
  private readonly setTimer: NonNullable<SchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<SchedulerOptions['clearTimer']>;

  constructor(private readonly options: SchedulerOptions) {
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as Timer));
  }

  poke(): void {
    this.cancel();
    const engine = this.options.engine();
    if (!engine) return;
    const state = engine.scheduleState();
    const plan = nextSync({ ...state, active: this.options.active() });
    engine.setNextAt(plan?.at ?? null);
    if (!plan) return;
    this.timer = this.setTimer(() => void this.fire(plan.kind), Math.max(0, plan.at - state.now));
  }

  stop(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private async fire(kind: 'incremental' | 'full'): Promise<void> {
    this.timer = null;
    const engine = this.options.engine();
    if (!engine) return;
    try {
      await engine.sync(kind === 'full');
    } catch {
      // The failure is on the engine (lastError, backoff) and in the status event; the next plan accounts for it.
    }
    this.poke();
  }
}

/** What a client shows from `status`; a change in any of it is worth an event. */
export function statusFingerprint(status: Status): string {
  const error = status.sync.lastError;
  return JSON.stringify([
    status.auth.state,
    status.auth.hint ?? null,
    status.cache.stale,
    error ? [error.kind, error.message] : null,
    status.sync.backoffUntil,
  ]);
}
