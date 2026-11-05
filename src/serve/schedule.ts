import type { ErrorKind } from '../interfaces/Serve';

/** Incremental sync while someone watches. */
export const INCREMENTAL_EVERY_MS = 60_000;
/** A full sync also notices deletions, which an incremental one cannot see. */
export const FULL_EVERY_MS = 30 * 60_000;
/** A data request finding the last sync older than this refreshes behind its answer. */
export const STALE_AFTER_MS = 30_000;
export const BACKOFF_MIN_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
/** A server asking for more than this is not waited for to the letter. */
const RETRY_AFTER_CAP_MS = 60 * 60_000;

/** What stops the schedule until the credential changes: retrying cannot help. */
const PAUSING_KINDS: readonly ErrorKind[] = ['needs_login', 'config_missing', 'config_invalid'];

export function pausesSync(kind: ErrorKind): boolean {
  return PAUSING_KINDS.includes(kind);
}

/** 30 s, 60 s, 2 min … up to 10 min; the server's Retry-After wins when it asks for longer. */
export function backoffDelay(failures: number, retryAfterMs?: number): number {
  const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, failures - 1));
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(exponential, retryAfterMs ?? 0));
}

/** Retry-After (seconds or an HTTP date) off an upstream error, when the client library kept it. */
export function retryAfterMs(err: unknown, now = Date.now()): number | undefined {
  const e = err as { retryAfter?: unknown; headers?: Record<string, unknown> } | null;
  const raw = e?.retryAfter ?? e?.headers?.['retry-after'] ?? e?.headers?.['Retry-After'];
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw * 1000);
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export interface ScheduleState {
  now: number;
  /** Someone is watching: with nobody, nothing is synced. */
  active: boolean;
  lastSyncAt: number | null;
  lastFullAt: number | null;
  backoffUntil: number | null;
  /** The last failure needs a new credential; waiting does not fix it. */
  paused: boolean;
}

export interface Plan {
  kind: 'incremental' | 'full';
  at: number;
}

/** The next sync and when, or null when none should run. */
export function nextSync(state: ScheduleState): Plan | null {
  if (!state.active || state.paused) return null;
  const incrementalAt = state.lastSyncAt === null ? state.now : state.lastSyncAt + INCREMENTAL_EVERY_MS;
  const fullAt = state.lastFullAt === null ? state.now : state.lastFullAt + FULL_EVERY_MS;
  const kind = fullAt <= incrementalAt ? 'full' : 'incremental';
  const at = Math.max(Math.min(fullAt, incrementalAt), state.backoffUntil ?? 0);
  return { kind, at };
}

/** Whether a data request should refresh behind its answer, and with which kind of sync. */
export function refreshOnRequest(state: Omit<ScheduleState, 'active'>): 'incremental' | 'full' | null {
  if (state.paused) return null;
  if (state.backoffUntil !== null && state.backoffUntil > state.now) return null;
  if (state.lastFullAt === null || state.now - state.lastFullAt >= FULL_EVERY_MS) return 'full';
  if (state.lastSyncAt === null || state.now - state.lastSyncAt > STALE_AFTER_MS) return 'incremental';
  return null;
}
